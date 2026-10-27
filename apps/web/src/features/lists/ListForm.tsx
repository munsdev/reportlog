/**
 * A list's form, one question per card: what somebody sees at /list/:slug.
 *
 * AN ENTRY IS NOT A REPORT. There is no consent card and no question about
 * publication, because nothing anybody writes here is published: at most, a
 * count of the fixed-answer questions is. The first card says so in words
 * rather than in a policy nobody opens.
 *
 * THE ADDRESS CARD appears only on a form where people can write something,
 * and asks for an address only from somebody who did (or, on a form for
 * reaching the site, from everybody, and says that is why). The server
 * decides from what actually arrived; this card only says it in advance.
 *
 * ONE CARD ASKS ONE QUESTION, and nothing on the card in front of somebody
 * changes underneath them: the address card's reason is worked out as they
 * arrive at it, not while they are on it. No auto-advance on selection.
 *
 * AT THE DOOR (features/door/): a start token as the form opens, a puzzle
 * solved in the background before Send works, and a box nobody can see.
 *
 * ON A DOOR (the site password is on and this list is open outside) this page
 * calls exactly its list's two routes and the door's two reads, nothing else.
 */
import { LINK_FIELD_WORDING, sendListEntry } from '@reportlog/contracts';
import type { ListForm as Form, ListFormQuestion } from '@reportlog/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CardBar,
  CardFrame,
  FilingProgress,
  useCardTitle,
  useFocusOnMount,
} from '../form/CardFrame.tsx';
import { CountyPicker } from '../form/CountyPicker.tsx';
import { FormColumn, FormNotice } from '../form/FormNotice.tsx';
import { CharacterCount, inputLimits, kindHelp } from '../form/QuestionControl.tsx';
import { DoorPuzzle, Honeypot, doorStatus, useDoor, useSendWhenReady } from '../door/useDoor.tsx';
import { clearTipPrefill, takeTipPrefill } from '../form/tipOffer.tsx';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Steps, Wrap } from '../../components/ui/band.tsx';
import { FollowBand } from '../follow/FollowBand.tsx';
import { useGateMode } from '../identity/gateMode.ts';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { CheckOption } from '../../components/ui/choice.tsx';
import { FieldReset } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { useSite } from '../../components/ui/site.tsx';
import { Eyebrow, Lede } from '../../components/ui/type.tsx';
import { Cover } from '../form/Cover.tsx';
import { RadioGroup, RadioOption } from '../../components/ui/radio-group.tsx';
import { Select } from '../../components/ui/select.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { ApiRequestError, call } from '../../lib/api.ts';
import { PausedForm, useIntakePaused } from '../flood/IntakePaused.tsx';
import { listFormQuery } from './queries.ts';
import { keptFor } from './words.ts';

/** Kept in step with PERSONAL_KINDS on the server, only to word the address card. */
const PERSONAL = new Set(['short_text', 'long_text', 'email', 'place']);

/** A row of a link question that asks what kind each link is. */
interface LinkRow {
  url: string;
  type: string;
}

type Value = string | string[] | LinkRow[] | undefined;

const blankRow = (r: LinkRow) => !r.url.trim() && !r.type.trim();

const blank = (v: Value): boolean =>
  v === undefined ||
  (Array.isArray(v)
    ? v.every((x: string | LinkRow) => (typeof x === 'string' ? !x.trim() : blankRow(x)))
    : !v.trim());

/** What is wrong with a question's link rows, in a sentence that names the row, or null. */
function rowProblem(q: ListFormQuestion, v: Value): string | null {
  if (!q.link_types?.length) return null;
  const rows = (Array.isArray(v) ? v : []) as LinkRow[];
  for (const [i, r] of rows.entries()) {
    const n = String(i + 1);
    if (r.url.trim() && !r.type) return `Link ${n} has no type. Choose what kind of thing it is.`;
    if (!r.url.trim() && r.type)
      return `Link ${n} has a type but no link. Add the link, or clear the row.`;
  }
  const first = rows[0];
  if (q.required && !first?.url.trim()) return 'Link 1 needs a link.';
  return null;
}

/**
 * What is sent: only what was answered. A row of a link question with
 * neither a link nor a type is not an answer, so it is never sent as an
 * empty row; the rows that are sent keep their order.
 */
function answersToSend(values: Record<string, Value>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(values)) {
    if (blank(v)) continue;
    const isRows = Array.isArray(v) && v.some((x: string | LinkRow) => typeof x === 'object');
    out[k] = isRows ? (v as LinkRow[]).filter((r) => !blankRow(r)) : v;
  }
  return out;
}

export function ListFormPage({ slug }: { slug: string }) {
  const query = useQuery(listFormQuery(slug));
  if (query.isPending) {
    return (
      <FormColumn>
        <p role="status">Opening the form…</p>
      </FormColumn>
    );
  }
  if (query.isError) {
    const gone = query.error instanceof ApiRequestError && query.error.status === 404;
    return (
      <FormNotice
        eyebrow="Send something"
        title={gone ? 'Not found' : 'This form could not be opened'}
      >
        {gone ? (
          <p className="max-w-prose">
            There is no form at this address. Check the address you were given. It may have a typing
            mistake in it.
          </p>
        ) : (
          <Alert tone="serious" title="The form did not load">
            Check your connection and try again.
          </Alert>
        )}
      </FormNotice>
    );
  }
  return <ListFormView form={query.data} />;
}

export function ListFormView({ form }: { form: Form }) {
  // Plan E: a moderator paused intake (features/flood).
  const paused = useIntakePaused();
  if (paused) return <PausedForm title={form.title} eyebrow="Send something" />;
  if (!form.accepting) {
    const opens = form.opens_at && new Date(form.opens_at) > new Date();
    return (
      <FormNotice eyebrow="Send something" title={form.title}>
        {form.blurb ? <Lede className="whitespace-pre-wrap">{form.blurb}</Lede> : null}
        <Card variant="quiet">
          <p className="max-w-prose">
            {opens
              ? `This form opens on ${new Date(form.opens_at ?? '').toLocaleString()}.`
              : 'This form is not taking anything at the moment.'}
          </p>
        </Card>
      </FormNotice>
    );
  }
  return <Cards form={form} />;
}

type Step = { kind: 'intro' } | { kind: 'question'; q: ListFormQuestion } | { kind: 'email' };

function Cards({ form }: { form: Form }) {
  const steps: Step[] = [
    { kind: 'intro' },
    ...form.fields.map((q): Step => ({ kind: 'question', q })),
    ...(form.asks_email ? [{ kind: 'email' } as const] : []),
  ];
  const [at, setAt] = useState(0);
  // The tips form starts with the state, county and time of a report just
  // filed in this browser (features/form/tipOffer.tsx). Browser only, and
  // visibly: they are the card's starting answers, which can be changed.
  const [values, setValues] = useState<Record<string, Value>>(() =>
    form.slug === 'tips' ? takeTipPrefill(form.fields) : {},
  );
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const door = useDoor();
  const [problem, setProblem] = useState<string | null>(null);
  // Worked out on ARRIVING at the address card, never while somebody is on it.
  const [wroteOnArrival, setWroteOnArrival] = useState(false);

  const step = steps[at] ?? { kind: 'intro' };
  const last = at === steps.length - 1;
  const wrote = form.fields.some((q) => PERSONAL.has(q.kind) && !blank(values[q.key]));

  const send = useMutation({
    mutationFn: () =>
      call(sendListEntry, {
        params: { slug: form.slug },
        body: {
          answers: answersToSend(values),
          email: email.trim() || null,
          email_consent: form.email_reason === 'reply' ? true : consent,
          ...door.fields(),
        },
      }),
    onError: (e) => {
      setProblem(e.message);
      // A solution is good for one send, accepted or refused.
      door.renew();
    },
  });

  const sending = useSendWhenReady(door, send);

  useEffect(() => {
    if (send.isSuccess) clearTipPrefill();
  }, [send.isSuccess]);

  const heading =
    step.kind === 'intro'
      ? form.title
      : step.kind === 'question'
        ? step.q.label
        : 'Your email address';
  useCardTitle(
    send.isSuccess ? 'Sent. Thank you.' : heading,
    send.isSuccess || at === 0 ? null : { n: at, of: steps.length - 1 },
  );

  if (send.isSuccess) {
    return (
      <Sent
        erasureMailed={send.data.erasure_mailed}
        erasable={send.data.erasable}
        days={form.personal_days}
        title={form.title}
      />
    );
  }

  const valid = (): string | null => {
    if (step.kind === 'question') {
      const rows = rowProblem(step.q, values[step.q.key]);
      if (rows) return rows;
      if (step.q.required && blank(values[step.q.key])) return 'An answer is needed here.';
    }
    if (step.kind === 'email' && !email.trim()) {
      if (form.email_when === 'always') return 'This form needs your email address.';
      if (wroteOnArrival) {
        return 'You wrote something, so an email address is needed: it is how you can have it deleted. Add one, or go back and remove the writing.';
      }
    }
    return null;
  };

  const go = (to: number) => {
    setProblem(null);
    if (steps[to]?.kind === 'email') setWroteOnArrival(wrote);
    setAt(to);
  };

  const next = () => {
    const wrong = valid();
    if (wrong) {
      setProblem(wrong);
      return;
    }
    if (last) {
      // Pressed before the door is ready, it goes when it is; the door's
      // status line above the button says what it is waiting for.
      sending.press();
    } else go(at + 1);
  };

  // No numbers on the page, as on a logbook: the share of the cards done.
  const progress = at === 0 ? null : at / steps.length;

  return (
    <FormColumn>
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        {/* A box nobody can see. Filled in means a script. */}
        <Honeypot door={door} />
        <DoorPuzzle door={door} />
        <FilingProgress value={progress} question={at === 0 ? null : at} />
        {step.kind === 'intro' ? (
          <Intro form={form} />
        ) : step.kind === 'question' ? (
          <Question
            key={step.q.key}
            eyebrow={form.title}
            q={step.q}
            days={form.personal_days}
            value={values[step.q.key]}
            problem={problem}
            onChange={(v) => {
              setProblem(null);
              setValues((all) => ({ ...all, [step.q.key]: v }));
            }}
          />
        ) : (
          <EmailCard
            eyebrow={form.title}
            form={form}
            wrote={wroteOnArrival}
            email={email}
            consent={consent}
            problem={problem}
            onEmail={(v) => {
              setProblem(null);
              setEmail(v);
            }}
            onConsent={setConsent}
          />
        )}
        <CardBar
          submit
          onBack={
            at > 0
              ? () => {
                  go(at - 1);
                }
              : undefined
          }
          primary={
            last
              ? 'Send'
              : at === 0
                ? form.cover?.button_label?.trim()
                  ? form.cover.button_label.trim()
                  : 'Start'
                : 'Next'
          }
          busy={send.isPending || sending.waiting}
          busyLabel="Sending…"
          above={
            <>
              {problem && step.kind === 'intro' ? <Alert tone="serious" title={problem} /> : null}
              {last && doorStatus(door) ? (
                <p role="status" className="text-sm text-ink-alt">
                  {doorStatus(door)}
                </p>
              ) : null}
            </>
          }
        />
      </form>
    </FormColumn>
  );
}

/**
 * After sending (mock-up tips-sent.html): quiet, never teal. What happens
 * next is read from the list's own settings, so nothing here promises what
 * the list does not do. Focus moves to the heading; the Follow along band
 * (placement `after_tip`) sits under it.
 */
function Sent({
  erasureMailed,
  erasable,
  days,
  title,
}: {
  erasureMailed: boolean;
  erasable: boolean;
  days: number | null;
  title: string;
}) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const onDoor = useGateMode() === 'door';
  return (
    <div data-bleed className="flex flex-col">
      <Wrap className="pt-8 pb-12">
        <div className="flex max-w-[40rem] flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Eyebrow>Sent</Eyebrow>
            <h1 ref={heading} tabIndex={-1} className="font-display text-title outline-none">
              Sent. Thank you.
            </h1>
          </div>
          <Steps
            items={[
              {
                title: 'A moderator reads it.',
                body: `Your message to “${title}” goes to the team.`,
              },
              { title: 'Nothing here is published.', body: 'Nothing you sent is published.' },
              {
                title:
                  days === null
                    ? 'It is kept until it is erased.'
                    : `It is deleted after ${String(days)} days.`,
                body: erasureMailed
                  ? 'We emailed you a link that deletes what you wrote and your email address. Keep that email if you might want to use it.'
                  : erasable
                    ? 'We could not email you the link that deletes what you wrote. Ask whoever runs this site if you want it deleted.'
                    : 'You gave no name or email, so there is nothing else to erase.',
              },
            ]}
          />
          <div className="flex flex-wrap items-center gap-3.5">
            <Button asChild variant="secondary">
              <a href={typeof window === 'undefined' ? '.' : window.location.pathname}>
                Send another
              </a>
            </Button>
            {onDoor ? null : (
              <Button asChild variant="quiet">
                <a href="/">Back to the front page</a>
              </Button>
            )}
          </div>
        </div>
      </Wrap>
      <FollowBand placement="after_tip" bleed />
    </div>
  );
}

/**
 * The first card: the shared cover (decision 78). What happens to an entry is
 * said on the email card, where it matters.
 */
/**
 * What this list does with what is sent, said before the first question
 * (mock-up tips.html): published or not, what it asks about you, how long it
 * is kept. Each line is read from the list's own settings, so none of it can
 * promise what the list does not do.
 */
function coverFacts(form: Form): { term: string; detail: string }[] {
  const parts: string[] = [];
  if (form.asks_email && form.email_when !== 'never') {
    parts.push(
      `Your email address${form.email_when === 'if-written' ? ', only if you write something' : ''}${
        form.email_reason === 'reply' ? ', so we can write back' : ', so you can have it erased'
      }.`,
    );
  }
  if (form.personal_keys.length) parts.push('Some answers are about you and are kept apart.');
  const asks = parts.length ? parts.join(' ') : 'Nothing. No name, no email.';
  const kept =
    form.personal_days === null
      ? form.asks_email
        ? 'Until you erase it from the link in your email.'
        : 'Until the team removes it.'
      : `${String(form.personal_days)} days, then deleted.`;
  return [
    { term: 'Published?', detail: 'No. Nothing sent here is published.' },
    { term: 'What we ask about you', detail: asks },
    { term: 'How long it is kept', detail: kept },
  ];
}

function Intro({ form }: { form: Form }) {
  const site = useSite().data?.copy;
  return (
    <Cover
      kind="list"
      title={form.title}
      blurb={form.blurb}
      cover={form.cover}
      facts={coverFacts(form)}
      // On a door the site cannot be asked, so a cover that follows it draws nothing.
      site={
        site
          ? {
              text: site.help_now,
              heading: site.cta_heading,
              buttonLabel: site.cta_button_text,
              buttonUrl: site.cta_button_url,
            }
          : null
      }
    />
  );
}

function Question({
  eyebrow,
  q,
  days,
  value,
  problem,
  onChange,
}: {
  eyebrow: string;
  q: ListFormQuestion;
  days: number | null;
  value: Value;
  problem: string | null;
  onChange: (v: Value) => void;
}) {
  const headingId = `q-${q.key}`;
  const helpId = `${headingId}-help`;
  const errorId = `${headingId}-error`;
  const extra = kindHelp({ kind: q.kind, settings: {} }, `${q.label} ${q.help ?? ''}`);
  const help = Boolean(q.help) || q.erased || extra !== null;
  return (
    <CardFrame
      eyebrow={eyebrow}
      heading={q.label}
      headingId={headingId}
      focusKey={q.key}
      optional={!q.required}
      help={
        help ? (
          <div id={helpId} className="flex max-w-prose flex-col gap-1 text-ink-alt">
            {q.help ? <p className="whitespace-pre-wrap">{q.help}</p> : null}
            {extra ? <p>{extra}</p> : null}
            {q.erased ? (
              <p className="text-sm">
                Deleted {days === null ? 'when you ask' : `after ${keptFor(days)}`}, with your email
                address.
              </p>
            ) : null}
          </div>
        ) : null
      }
      error={problem}
      errorId={errorId}
    >
      <Control
        q={q}
        value={value}
        labelledBy={headingId}
        describedBy={[help ? helpId : '', problem ? errorId : ''].filter(Boolean).join(' ')}
        invalid={Boolean(problem)}
        onChange={onChange}
      />
    </CardFrame>
  );
}

function Control({
  q,
  value,
  labelledBy,
  describedBy,
  invalid,
  onChange,
}: {
  q: ListFormQuestion;
  value: Value;
  labelledBy: string;
  describedBy: string;
  invalid: boolean;
  onChange: (v: Value) => void;
}): ReactNode {
  const text = typeof value === 'string' ? value : '';
  const list = Array.isArray(value) ? value : [];
  const named = {
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': invalid || undefined,
  };

  if (q.kind === 'url' && q.link_types?.length) {
    return <LinkRows q={q} value={value} labelledBy={labelledBy} onChange={onChange} />;
  }
  if (q.kind === 'url') {
    const boxes = (list.length ? list : [text]) as string[];
    const put = (i: number, v: string) => {
      const all = [...boxes];
      all[i] = v;
      onChange(q.max_values > 1 ? all : all[0]);
    };
    return (
      <div className="flex flex-col gap-2">
        {/* K2: part of the field type, so every form asking for a link says it. */}
        <p className="max-w-prose text-sm text-ink-alt" data-testid="link-wording">
          {LINK_FIELD_WORDING}
        </p>
        {boxes.map((b, i) => (
          <Input
            // Boxes only ever grow at the end, so a position is a stable key.
            key={`link-${String(i)}`}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://"
            value={b}
            {...(i === 0 ? named : { 'aria-label': `Another link (${String(i + 1)})` })}
            onChange={(e) => {
              put(i, e.target.value);
            }}
          />
        ))}
        {q.max_values > 1 && boxes.length < q.max_values ? (
          <div>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                onChange([...boxes, '']);
              }}
            >
              Add another link
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  if (q.kind === 'yes_no') {
    return (
      <RadioGroup value={text} onValueChange={onChange} {...named}>
        <RadioOption value="yes" label="Yes" />
        <RadioOption value="no" label="No" />
      </RadioGroup>
    );
  }
  // The CODE is sent; the label, where there is one, is what is read.
  const words = (o: string, i: number) => q.option_labels?.[i] ?? o;
  if ((q.kind === 'choice_one' || q.kind === 'place') && q.options.length && !q.allow_other) {
    return (
      <RadioGroup value={text} onValueChange={onChange} {...named}>
        {q.options.map((o, i) => (
          <RadioOption key={o} value={o} label={words(o, i)} />
        ))}
      </RadioGroup>
    );
  }
  if (q.kind === 'choice_many') {
    return (
      <div role="group" className="flex flex-col gap-3" {...named}>
        {q.options.map((o, i) => {
          const id = `${labelledBy}-${o}`;
          const ticked = list as string[];
          return (
            <CheckOption
              key={o}
              id={id}
              checked={ticked.includes(o)}
              onCheckedChange={(on) => {
                onChange(on === true ? [...ticked, o] : ticked.filter((x) => x !== o));
              }}
              label={words(o, i)}
            />
          );
        })}
      </div>
    );
  }
  if (q.kind === 'location' && q.depth === 'county') {
    return (
      <CountyPicker
        states={q.places ?? []}
        value={text}
        onChange={onChange}
        labelledBy={labelledBy}
        describedBy={describedBy || undefined}
        invalid={invalid}
      />
    );
  }
  if (q.kind === 'location') {
    return (
      <Select
        value={text}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        {...named}
      >
        <option value="">Choose a place</option>
        {(q.places ?? []).map((p) => (
          <option key={p.code} value={p.code}>
            {p.name}
          </option>
        ))}
      </Select>
    );
  }
  if (q.kind === 'long_text') {
    return (
      <div className="flex flex-col gap-1">
        <Textarea
          value={text}
          rows={6}
          maxLength={1000}
          className="min-h-40 [field-sizing:content]"
          onChange={(e) => {
            onChange(e.target.value);
          }}
          {...named}
        />
        <CharacterCount length={text.length} max={1000} />
      </div>
    );
  }
  const types: Record<string, string> = {
    number: 'number',
    date: 'date',
    time: 'time',
    datetime: 'datetime-local',
    email: 'email',
  };
  const max = q.kind === 'short_text' || q.kind === 'place' ? 200 : null;
  return (
    <div className="flex flex-col gap-1">
      <Input
        type={types[q.kind] ?? 'text'}
        value={q.kind === 'datetime' && text ? toLocal(text) : text}
        {...(max === null ? {} : { maxLength: max })}
        {...(q.kind === 'email' ? { inputMode: 'email' as const, autoComplete: 'email' } : {})}
        {...(q.kind === 'number' ? { inputMode: 'numeric' as const } : {})}
        {...inputLimits({ kind: q.kind, settings: { earliest: q.earliest, latest: q.latest } })}
        onChange={(e) => {
          const v = e.target.value;
          onChange(q.kind === 'datetime' && v ? new Date(v).toISOString() : v);
        }}
        {...named}
      />
      {max === null ? null : <CharacterCount length={text.length} max={max} />}
    </div>
  );
}

/**
 * ROWS OF A LINK AND WHAT KIND OF THING IT IS (voting questionnaires
 * §04). With `fixed_rows` every row is on the card from the start and none
 * is added or removed, so nothing on the card moves. Row 1 is the one a
 * required question needs. The fixed wording (K2) sits above the rows. Each
 * row is a plain panel: the link and its kind stacked on a phone, side by
 * side on a desktop.
 */
function LinkRows({
  q,
  value,
  labelledBy,
  onChange,
}: {
  q: ListFormQuestion;
  value: Value;
  labelledBy: string;
  onChange: (v: Value) => void;
}) {
  const given = (Array.isArray(value) ? value : []) as LinkRow[];
  const count = q.fixed_rows ? q.max_values : Math.max(1, given.length);
  const rows = Array.from({ length: count }, (_, i) => given[i] ?? { url: '', type: '' });
  const put = (i: number, row: LinkRow) => {
    onChange(rows.map((r, j) => (j === i ? row : r)));
  };
  return (
    <div className="flex flex-col gap-4" role="group" aria-labelledby={labelledBy}>
      <p className="max-w-prose text-sm text-ink-alt" data-testid="link-wording">
        {LINK_FIELD_WORDING}
      </p>
      {/* Each row's two controls carry their own labels, not the card's one id. */}
      <FieldReset>
        {rows.map((row, i) => {
          const n = String(i + 1);
          const optional = !(q.required && i === 0);
          return (
            // The rule is on a box around the fieldset, so the legend sits
            // under it rather than breaking it.
            <div key={`row-${n}`} className="border-t border-ink-alt pt-3">
              <fieldset className="flex flex-col gap-2">
                <legend className="label-face mb-2 text-[0.8125rem]">
                  Link {n}
                  {optional ? (
                    <span className="font-sans font-normal tracking-normal normal-case text-ink-alt">
                      {' '}
                      (optional)
                    </span>
                  ) : null}
                </legend>
                <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[2fr_1fr] sm:gap-x-4">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${labelledBy}-url-${n}`}>Link</Label>
                    <Input
                      id={`${labelledBy}-url-${n}`}
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="https://"
                      maxLength={2000}
                      value={row.url}
                      onChange={(e) => {
                        put(i, { ...row, url: e.target.value });
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${labelledBy}-type-${n}`}>What kind of thing is it?</Label>
                    <Select
                      id={`${labelledBy}-type-${n}`}
                      value={row.type}
                      onChange={(e) => {
                        put(i, { ...row, type: e.target.value });
                      }}
                    >
                      <option value="">Choose one</option>
                      {(q.link_types ?? []).map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </fieldset>
            </div>
          );
        })}
      </FieldReset>
    </div>
  );
}

/** An ISO moment as what a datetime-local box shows, in the reader's time. */
function toLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function EmailCard({
  eyebrow,
  form,
  wrote,
  email,
  consent,
  problem,
  onEmail,
  onConsent,
}: {
  eyebrow: string;
  form: Form;
  wrote: boolean;
  email: string;
  consent: boolean;
  problem: string | null;
  onEmail: (v: string) => void;
  onConsent: (v: boolean) => void;
}) {
  const always = form.email_when === 'always';
  const reply = form.email_reason === 'reply';
  const why = always
    ? reply
      ? 'So whoever runs this site can reply. We also email you a link that deletes what you sent, and your address with it.'
      : 'We email you a link that deletes what you sent, and your address with it.'
    : wrote
      ? 'Needed, because you wrote something: we email you a link that deletes it, and your address with it.'
      : 'Not needed: you have not written anything. Leave it empty unless you want a reply.';
  // Said in as many words as the list's own switch, because this is the card
  // where somebody decides whether to give an address.
  const writeBack = 'The team will use this address to write back to you.';
  return (
    <CardFrame
      eyebrow={eyebrow}
      heading="Your email address"
      headingId="list-email-heading"
      focusKey="email"
      optional={!always && !wrote}
      help={
        <p id="list-email-help" className="max-w-prose text-ink-alt">
          {form.write_back ? `${writeBack} ` : ''}
          {why}
        </p>
      }
      error={problem}
      errorId="list-email-error"
    >
      <Input
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        aria-labelledby="list-email-heading"
        aria-describedby={['list-email-help', problem ? 'list-email-error' : '']
          .filter(Boolean)
          .join(' ')}
        aria-invalid={problem ? true : undefined}
        onChange={(e) => {
          onEmail(e.target.value);
        }}
      />
      {/* On a form for reaching the site, sending it IS asking for a reply. */}
      {reply ? null : (
        <CheckOption
          id="list-consent"
          label="You may write back to me about this"
          hint="Only about what you sent. Not a newsletter, and not passed to anybody."
          checked={consent}
          onCheckedChange={(on) => {
            onConsent(on === true);
          }}
        />
      )}
    </CardFrame>
  );
}
