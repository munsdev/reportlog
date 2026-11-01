/**
 * A list's form, one question per card: what somebody sees at /:slug (and the older /list/:slug).
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
import { useCardTitle, useFocusOnMount } from '../form/CardFrame.tsx';
import { resolveCta } from '../form/Cover.tsx';
import { HelpNow } from '../form/HelpNow.tsx';
import { inputLimits, kindHelp } from '../form/QuestionControl.tsx';
import { DoorPuzzle, Honeypot, doorStatus, useDoor, useSendWhenReady } from '../door/useDoor.tsx';
import { clearTipPrefill, takeTipPrefill } from '../form/tipOffer.tsx';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { FollowBand } from '../follow/FollowBand.tsx';
import { useGateMode } from '../identity/gateMode.ts';
import { useSite } from '../../components/ui/site.tsx';
import { Narrow } from '../../mockup/Narrow.tsx';
import { Choice, Field, QBar, QCard, QError, QHeading, QProgress } from '../../mockup/Qcard.tsx';
import { ApiRequestError, call } from '../../lib/api.ts';
import { PausedForm, useIntakePaused } from '../flood/IntakePaused.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { ListCounty } from './ListCounty.tsx';
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

/** The mock-up's light form page: ground class on <body> while it is shown. */
function FormGround() {
  useBodyClass('light', 'form');
  return null;
}

/** A page that says something and stops (not found, not open): tips-sent's column. */
function ListNotice({ title, children }: { title: string; children: ReactNode }) {
  const onDoor = useGateMode() === 'door';
  useCardTitle(title);
  return (
    <>
      <FormGround />
      <Narrow top={30} max={640} gap={20} inner>
        <span className="eyebrow">Send something</span>
        <h1 className="h-page" id="h1">
          {title}
        </h1>
        {children}
        {/* Both are behind the password on a door. */}
        {onDoor ? null : (
          <div className="btn-row">
            <a className="btn" href="/">
              The front page
            </a>
            <a className="btn ghost" href="/board">
              The board
            </a>
          </div>
        )}
      </Narrow>
    </>
  );
}

export function ListFormPage({ slug }: { slug: string }) {
  const query = useQuery(listFormQuery(slug));
  if (query.isPending) {
    return (
      <>
        <FormGround />
        <Narrow top={30} max={640} gap={20} inner>
          <p role="status" className="muted">
            Opening the form…
          </p>
        </Narrow>
      </>
    );
  }
  if (query.isError) {
    const gone = query.error instanceof ApiRequestError && query.error.status === 404;
    return (
      <ListNotice title={gone ? 'Not found' : 'This form could not be opened'}>
        {gone ? (
          <p>
            There is no form at this address. Check the address you were given. It may have a typing
            mistake in it.
          </p>
        ) : (
          <div className="note warn" role="alert">
            <span>
              <b>The form did not load.</b> Check your connection and try again.
            </span>
          </div>
        )}
      </ListNotice>
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
      <ListNotice title={form.title}>
        {form.blurb ? <p className="whitespace-pre-wrap muted">{form.blurb}</p> : null}
        <section className="panel quiet">
          <p>
            {opens
              ? `This form opens on ${new Date(form.opens_at ?? '').toLocaleString()}.`
              : 'This form is not taking anything at the moment.'}
          </p>
        </section>
      </ListNotice>
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
  const percent = (at / steps.length) * 100;

  if (step.kind === 'intro') {
    return (
      <>
        <FormGround />
        {/* A box nobody can see. Filled in means a script. */}
        <Honeypot door={door} />
        <DoorPuzzle door={door} />
        <Intro
          form={form}
          onStart={() => {
            go(1);
          }}
        />
      </>
    );
  }

  const statusLine = last && doorStatus(door);
  return (
    <>
      <FormGround />
      <QCard
        headingId={step.kind === 'question' ? `q-${step.q.key}` : 'list-email-heading'}
        onSubmit={next}
      >
        <Honeypot door={door} />
        <DoorPuzzle door={door} />
        <span className="eyebrow">Send something</span>
        <QProgress percent={percent} />
        <span className="step">Question {at}</span>
        {step.kind === 'question' ? (
          <Question
            key={step.q.key}
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
        <QBar
          go={last}
          onBack={() => {
            go(at - 1);
          }}
          primary={last ? 'Send' : 'Next'}
          busy={send.isPending || sending.waiting}
          busyLabel="Sending…"
          above={
            statusLine ? (
              <p role="status" className="muted">
                {statusLine}
              </p>
            ) : null
          }
        />
      </QCard>
    </>
  );
}

/**
 * After sending (mock-up tips-sent.html). What happens next is read from the
 * list's own settings, so nothing here promises what the list does not do.
 * Focus moves to the heading; the Follow along band (placement `after_tip`)
 * sits under it.
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
  const items = [
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
  ];
  return (
    <>
      <FormGround />
      <Narrow top={30} max={640} gap={20} inner>
        <span className="eyebrow">Sent</span>
        <h1 ref={heading} tabIndex={-1} className="h-page" id="h1" style={{ outline: 'none' }}>
          Sent. Thank you.
        </h1>
        <ol className="steps">
          {items.map((i) => (
            <li key={i.title}>
              <span>
                <b>{i.title}</b>
                {i.body}
              </span>
            </li>
          ))}
        </ol>
        <div className="btn-row">
          <a className="btn" href={typeof window === 'undefined' ? '.' : window.location.pathname}>
            Send another
          </a>
          {onDoor ? null : (
            <a className="btn ghost" href="/">
              Back to the front page
            </a>
          )}
        </div>
      </Narrow>
      <FollowBand placement="after_tip" bleed />
    </>
  );
}

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

/** The first card (mock-up tips.html): the cover, with its Start button in the body. */
function Intro({ form, onStart }: { form: Form; onStart: () => void }) {
  const site = useSite().data?.copy;
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const cover = form.cover;
  const eyebrow = cover?.eyebrow?.trim() ? cover.eyebrow.trim() : `List · ${form.title}`;
  const intro = cover?.intro?.trim();
  const label = cover?.button_label?.trim() ? cover.button_label.trim() : 'Start';
  // On a door the site cannot be asked, so a cover that follows it draws nothing.
  const cta = resolveCta(
    'list',
    cover,
    site
      ? {
          text: site.help_now,
          heading: site.cta_heading,
          buttonLabel: site.cta_button_text,
          buttonUrl: site.cta_button_url,
        }
      : null,
  );
  return (
    <div data-bleed>
      <div className="wrap" style={{ paddingTop: 26 }}>
        <div className="cover">
          <div className="cover-top motif-host">
            <div className="ov" data-slot="cover" />
            <div className="in">
              <span className="eyebrow">{eyebrow}</span>
              <h1 ref={heading} tabIndex={-1} className="h-page" style={{ outline: 'none' }}>
                {form.title}
              </h1>
            </div>
          </div>
          <div className="body">
            {form.blurb ? <p className="whitespace-pre-wrap">{form.blurb}</p> : null}
            {intro ? <p className="whitespace-pre-wrap">{intro}</p> : null}
            {cta ? <HelpNow {...cta} mini /> : null}
            <dl className="kv-list">
              {coverFacts(form).map((f) => (
                <div key={f.term}>
                  <dt>{f.term}</dt>
                  <dd>{f.detail}</dd>
                </div>
              ))}
            </dl>
            <button className="btn go lg" type="button" onClick={onStart}>
              {label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Words for the first links, as the mock-up has them. */
const ORDINAL = ['First', 'Second', 'Third'];

function Question({
  q,
  days,
  value,
  problem,
  onChange,
}: {
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
  // A long answer carries its help beside the counter, as the mock-up's does.
  const inField = q.kind === 'long_text';
  const help = Boolean(q.help) || q.erased || extra !== null;
  const helpBody = (
    <>
      {q.help ? <span className="whitespace-pre-wrap">{q.help} </span> : null}
      {extra ? <span>{extra} </span> : null}
      {q.erased ? (
        <span>
          Deleted {days === null ? 'when you ask' : `after ${keptFor(days)}`}, with your email
          address.
        </span>
      ) : null}
    </>
  );
  const describedBy = [help ? helpId : '', problem ? errorId : ''].filter(Boolean).join(' ');
  const asGroup = isChoiceQuestion(q);
  const common = {
    q,
    value,
    labelledBy: headingId,
    describedBy,
    invalid: Boolean(problem),
    onChange,
    inFieldHelp: inField && help ? { id: helpId, body: helpBody } : null,
  };
  const error = problem ? <QError id={errorId}>{problem}</QError> : null;
  if (asGroup) {
    return (
      <>
        <fieldset
          style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 14 }}
          aria-describedby={describedBy || undefined}
        >
          <legend>
            <QHeading id={headingId} focusKey={q.key}>
              {q.label}
            </QHeading>
          </legend>
          {help ? (
            <p className="muted" id={helpId}>
              {helpBody}
            </p>
          ) : null}
          <Control {...common} />
        </fieldset>
        {error}
      </>
    );
  }
  return (
    <>
      <QHeading id={headingId} focusKey={q.key}>
        {q.label}
      </QHeading>
      {help && !inField ? (
        <p className="muted" id={helpId}>
          {helpBody}
        </p>
      ) : null}
      <Control {...common} optional={!q.required} />
      {error}
    </>
  );
}

/** Questions answered by ticking, which the mock-up sets in a fieldset under a legend. */
function isChoiceQuestion(q: ListFormQuestion): boolean {
  if (q.kind === 'yes_no' || q.kind === 'choice_many') return true;
  return (q.kind === 'choice_one' || q.kind === 'place') && q.options.length > 0 && !q.allow_other;
}

function Control({
  q,
  value,
  labelledBy,
  describedBy,
  invalid,
  onChange,
  optional = false,
  inFieldHelp,
}: {
  q: ListFormQuestion;
  value: Value;
  labelledBy: string;
  describedBy: string;
  invalid: boolean;
  onChange: (v: Value) => void;
  optional?: boolean;
  inFieldHelp: { id: string; body: ReactNode } | null;
}): ReactNode {
  const text = typeof value === 'string' ? value : '';
  const list = Array.isArray(value) ? value : [];
  const id = `${labelledBy}-in`;
  const aria = {
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
      <>
        {/* K2: part of the field type, so every form asking for a link says it. */}
        <p className="muted" data-testid="link-wording">
          {LINK_FIELD_WORDING}
        </p>
        {boxes.map((b, i) => (
          <Field
            // Boxes only ever grow at the end, so a position is a stable key.
            key={`link-${String(i)}`}
            label={q.max_values > 1 ? `${ORDINAL[i] ?? `Link ${String(i + 1)}`} link` : q.label}
            htmlFor={`${id}-${String(i)}`}
            optional={i > 0 || optional}
          >
            <input
              className="input"
              id={`${id}-${String(i)}`}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://"
              value={b}
              {...(i === 0 ? aria : {})}
              onChange={(e) => {
                put(i, e.target.value);
              }}
            />
          </Field>
        ))}
        {q.max_values > 1 && boxes.length < q.max_values ? (
          <div>
            <button
              className="btn sm flat ghost"
              type="button"
              onClick={() => {
                onChange([...boxes, '']);
              }}
            >
              Add another link
            </button>
          </div>
        ) : null}
      </>
    );
  }
  if (q.kind === 'yes_no') {
    return (
      <div className="choices" role="radiogroup" aria-labelledby={labelledBy}>
        <Choice
          name={labelledBy}
          checked={text === 'yes'}
          onChange={() => {
            onChange('yes');
          }}
        >
          Yes
        </Choice>
        <Choice
          name={labelledBy}
          checked={text === 'no'}
          onChange={() => {
            onChange('no');
          }}
        >
          No
        </Choice>
      </div>
    );
  }
  // The CODE is sent; the label, where there is one, is what is read.
  const words = (o: string, i: number) => q.option_labels?.[i] ?? o;
  if ((q.kind === 'choice_one' || q.kind === 'place') && q.options.length && !q.allow_other) {
    return (
      <div className="choices" role="radiogroup" aria-labelledby={labelledBy}>
        {q.options.map((o, i) => (
          <Choice
            key={o}
            name={labelledBy}
            checked={text === o}
            onChange={() => {
              onChange(o);
            }}
          >
            {words(o, i)}
          </Choice>
        ))}
      </div>
    );
  }
  if (q.kind === 'choice_many') {
    const ticked = list as string[];
    return (
      <div className="choices" role="group" aria-labelledby={labelledBy}>
        {q.options.map((o, i) => (
          <Choice
            key={o}
            type="checkbox"
            checked={ticked.includes(o)}
            onChange={(on) => {
              onChange(on ? [...ticked, o] : ticked.filter((x) => x !== o));
            }}
          >
            {words(o, i)}
          </Choice>
        ))}
      </div>
    );
  }
  if (q.kind === 'location' && q.depth === 'county') {
    return (
      <ListCounty
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
      <Field label={q.label} htmlFor={id} optional={optional}>
        <select
          className="sel"
          id={id}
          value={text}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          {...aria}
        >
          <option value="">Choose a place</option>
          {(q.places ?? []).map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (q.kind === 'long_text') {
    return (
      <Field
        label={q.label}
        htmlFor={id}
        optional={optional}
        help={
          <span id={inFieldHelp?.id}>
            {inFieldHelp?.body}
            <span className="mono">{`${String(text.length)} / 1000`}</span>
          </span>
        }
      >
        <textarea
          className="textarea"
          id={id}
          value={text}
          maxLength={1000}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          {...aria}
        />
      </Field>
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
    <Field label={q.label} htmlFor={id} optional={optional}>
      <input
        className="input"
        id={id}
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
        {...aria}
      />
    </Field>
  );
}

/**
 * ROWS OF A LINK AND WHAT KIND OF THING IT IS (voting questionnaires
 * §04). With `fixed_rows` every row is on the card from the start and none
 * is added or removed, so nothing on the card moves. Row 1 is the one a
 * required question needs. The fixed wording (K2) sits above the rows.
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
    <div style={{ display: 'grid', gap: 14 }} role="group" aria-labelledby={labelledBy}>
      <p className="muted" data-testid="link-wording">
        {LINK_FIELD_WORDING}
      </p>
      {rows.map((row, i) => {
        const n = String(i + 1);
        const optional = !(q.required && i === 0);
        return (
          <fieldset key={`row-${n}`} className="panel" style={{ margin: 0 }}>
            <legend className="step">
              Link {n}
              {optional ? ' (optional)' : ''}
            </legend>
            <Field label="Link" htmlFor={`${labelledBy}-url-${n}`}>
              <input
                className="input"
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
            </Field>
            <Field label="What kind of thing is it?" htmlFor={`${labelledBy}-type-${n}`}>
              <select
                className="sel"
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
              </select>
            </Field>
          </fieldset>
        );
      })}
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
  form,
  wrote,
  email,
  consent,
  problem,
  onEmail,
  onConsent,
}: {
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
    <>
      <QHeading id="list-email-heading" focusKey="email">
        Your email address
      </QHeading>
      <p className="muted" id="list-email-help">
        {form.write_back ? `${writeBack} ` : ''}
        {why}
      </p>
      <Field label="Email" htmlFor="list-email" optional={!always && !wrote}>
        <input
          className="input"
          id="list-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          aria-describedby={['list-email-help', problem ? 'list-email-error' : '']
            .filter(Boolean)
            .join(' ')}
          aria-invalid={problem ? true : undefined}
          onChange={(e) => {
            onEmail(e.target.value);
          }}
        />
      </Field>
      {/* On a form for reaching the site, sending it IS asking for a reply. */}
      {reply ? null : (
        <label className="check">
          <input
            id="list-consent"
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              onConsent(e.target.checked);
            }}
          />
          <span>
            You may write back to me about this
            <span className="help muted" style={{ display: 'block' }}>
              Only about what you sent. Not a newsletter, and not passed to anybody.
            </span>
          </span>
        </label>
      )}
      {problem ? <QError id="list-email-error">{problem}</QError> : null}
    </>
  );
}
