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
 * ON A DOOR (the site password is on and this list is open outside) this page
 * calls exactly its list's two routes and nothing else.
 */
import { LINK_FIELD_WORDING, sendListEntry } from '@reportlog/contracts';
import type { ListForm as Form, ListFormQuestion } from '@reportlog/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { clearTipPrefill, takeTipPrefill } from '../form/tipOffer.tsx';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Field, FieldDescription, FieldError } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
import { RadioGroup, RadioOption } from '../../components/ui/radio-group.tsx';
import { Select } from '../../components/ui/select.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { ApiRequestError, call } from '../../lib/api.ts';
import { listFormQuery } from './queries.ts';
import { keptFor } from './words.ts';

/** Kept in step with PERSONAL_KINDS on the server, only to word the address card. */
const PERSONAL = new Set(['short_text', 'long_text', 'email', 'place']);

type Value = string | string[] | undefined;

const blank = (v: Value) =>
  v === undefined || (Array.isArray(v) ? v.every((x) => !x.trim()) : !v.trim());

export function ListFormPage({ slug }: { slug: string }) {
  const query = useQuery(listFormQuery(slug));
  if (query.isPending) return <p role="status">Opening the form…</p>;
  if (query.isError) {
    const gone = query.error instanceof ApiRequestError && query.error.status === 404;
    return (
      <Page title={gone ? 'Not found' : 'This form could not be opened'} width="prose">
        <Alert tone={gone ? 'note' : 'serious'}>
          {gone
            ? 'There is no form at this address.'
            : 'The form could not be loaded. Check your connection and try again.'}
        </Alert>
      </Page>
    );
  }
  return <ListFormView form={query.data} />;
}

export function ListFormView({ form }: { form: Form }) {
  if (!form.accepting) {
    const opens = form.opens_at && new Date(form.opens_at) > new Date();
    return (
      <Page title={form.title} lede={form.blurb} width="prose">
        <Alert>
          {opens
            ? `This form opens on ${new Date(form.opens_at ?? '').toLocaleString()}.`
            : 'This form is not taking anything at the moment.'}
        </Alert>
      </Page>
    );
  }
  return (
    <Page title={form.title} lede={form.blurb} width="prose">
      <Cards form={form} />
    </Page>
  );
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
  // filed in this browser (features/form/tipOffer.tsx). Browser only.
  const [values, setValues] = useState<Record<string, Value>>(() =>
    form.slug === 'tips' ? takeTipPrefill(form.fields) : {},
  );
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // Worked out on ARRIVING at the address card, never while somebody is on it.
  const [wroteOnArrival, setWroteOnArrival] = useState(false);
  const [started] = useState(() => Date.now());
  const heading = useRef<HTMLHeadingElement>(null);

  const step = steps[at] ?? { kind: 'intro' };
  const last = at === steps.length - 1;
  const wrote = form.fields.some((q) => PERSONAL.has(q.kind) && !blank(values[q.key]));

  const send = useMutation({
    mutationFn: () =>
      call(sendListEntry, {
        params: { slug: form.slug },
        body: {
          answers: Object.fromEntries(Object.entries(values).filter(([, v]) => !blank(v))),
          email: email.trim() || null,
          email_consent: form.email_reason === 'reply' ? true : consent,
          website,
          elapsed_ms: Date.now() - started,
        },
      }),
    onError: (e) => {
      setProblem(e.message);
    },
  });

  useEffect(() => {
    heading.current?.focus();
  }, [at, send.isSuccess]);
  useEffect(() => {
    if (send.isSuccess) clearTipPrefill();
  }, [send.isSuccess]);

  if (send.isSuccess) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 ref={heading} tabIndex={-1} className="font-display text-2xl font-bold">
            Sent. Thank you.
          </h2>
          <p>Nothing you sent is published. A moderator reads it.</p>
          {send.data.erasure_mailed ? (
            <p>
              We emailed you a link that deletes what you wrote and your email address. Keep that
              email if you might want to use it.
            </p>
          ) : send.data.erasable ? (
            <p>
              We could not email you the link that deletes what you wrote. Ask whoever runs this
              site if you want it deleted.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  const valid = (): string | null => {
    if (step.kind === 'question' && step.q.required && blank(values[step.q.key])) {
      return 'An answer is needed here.';
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
    if (last) send.mutate();
    else go(at + 1);
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        next();
      }}
    >
      {/* A box nobody can see. Filled in means a script. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Leave this empty
          <input
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => {
              setWebsite(e.target.value);
            }}
          />
        </label>
      </div>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm text-ink-alt">
            {String(at + 1)} of {String(steps.length)}
          </p>
          {step.kind === 'intro' ? (
            <Intro form={form} heading={heading} />
          ) : step.kind === 'question' ? (
            <Question
              q={step.q}
              days={form.personal_days}
              value={values[step.q.key]}
              problem={problem}
              heading={heading}
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
              heading={heading}
              onEmail={(v) => {
                setProblem(null);
                setEmail(v);
              }}
              onConsent={setConsent}
            />
          )}
          {problem && step.kind === 'intro' ? <Alert tone="serious">{problem}</Alert> : null}
          <div className="flex flex-wrap gap-3 pt-2">
            {at > 0 ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  go(at - 1);
                }}
              >
                Back
              </Button>
            ) : null}
            <Button type="submit" disabled={send.isPending}>
              {last ? (send.isPending ? 'Sending…' : 'Send') : at === 0 ? 'Start' : 'Next'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

function Intro({ form, heading }: { form: Form; heading: RefObject<HTMLHeadingElement | null> }) {
  const gone = `${form.personal_days === null ? 'when you ask' : `after ${keptFor(form.personal_days)}`}, or sooner if you use the link we email you`;
  const address: Record<Form['email_when'], string> = {
    always:
      form.email_reason === 'reply'
        ? `This form asks for your email address, so whoever runs this site can reply. What you write and your address are deleted ${gone}.`
        : `This form asks for your email address, so you can have what you send deleted. What you write and your address are deleted ${gone}.`,
    'if-written': `Writing anything is up to you. If you do, you will be asked for an email address, so you can have it deleted; it is deleted ${gone}. Links and choices are kept.`,
    never: 'Nothing here asks about you, and no email address is needed.',
  };
  return (
    <div className="space-y-3">
      <h2 ref={heading} tabIndex={-1} className="font-display text-2xl font-bold">
        Before you start
      </h2>
      <p>
        Nothing you send here is published. A moderator reads it, and at most a count of the answers
        is ever made public.
      </p>
      <p>{address[form.email_when]}</p>
    </div>
  );
}

function QuestionHeading({
  q,
  heading,
  id,
}: {
  q: ListFormQuestion;
  heading: RefObject<HTMLHeadingElement | null>;
  id: string;
}) {
  return (
    <h2 ref={heading} id={id} tabIndex={-1} className="font-display text-2xl font-bold">
      {q.label}
      {q.required ? null : (
        <>
          {' '}
          <span className="text-base font-normal text-ink-alt">(optional)</span>
        </>
      )}
    </h2>
  );
}

function Question({
  q,
  days,
  value,
  problem,
  heading,
  onChange,
}: {
  q: ListFormQuestion;
  days: number | null;
  value: Value;
  problem: string | null;
  heading: RefObject<HTMLHeadingElement | null>;
  onChange: (v: Value) => void;
}) {
  const headingId = `q-${q.key}`;
  return (
    <Field>
      <QuestionHeading q={q} heading={heading} id={headingId} />
      {q.help ? <FieldDescription>{q.help}</FieldDescription> : null}
      {q.erased ? (
        <p className="text-sm text-ink-alt">
          Deleted {days === null ? 'when you ask' : `after ${keptFor(days)}`}, with your email
          address.
        </p>
      ) : null}
      <Control q={q} value={value} labelledBy={headingId} onChange={onChange} />
      <FieldError>{problem}</FieldError>
    </Field>
  );
}

function Control({
  q,
  value,
  labelledBy,
  onChange,
}: {
  q: ListFormQuestion;
  value: Value;
  labelledBy: string;
  onChange: (v: Value) => void;
}): ReactNode {
  const text = typeof value === 'string' ? value : '';
  const list = Array.isArray(value) ? value : [];
  const named = { 'aria-labelledby': labelledBy };

  if (q.kind === 'url') {
    const boxes = list.length ? list : [text];
    const put = (i: number, v: string) => {
      const all = [...boxes];
      all[i] = v;
      onChange(q.max_values > 1 ? all : all[0]);
    };
    return (
      <div className="space-y-2">
        {/* K2: part of the field type, so every form asking for a link says it. */}
        <p className="text-sm text-ink-alt" data-testid="link-wording">
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
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={() => {
              onChange([...boxes, '']);
            }}
          >
            Add another link
          </Button>
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
  if ((q.kind === 'choice_one' || q.kind === 'place') && q.options.length && !q.allow_other) {
    return (
      <RadioGroup value={text} onValueChange={onChange} {...named}>
        {q.options.map((o) => (
          <RadioOption key={o} value={o} label={o} />
        ))}
      </RadioGroup>
    );
  }
  if (q.kind === 'choice_many') {
    return (
      <div role="group" className="flex flex-col gap-3" {...named}>
        {q.options.map((o) => {
          const id = `${labelledBy}-${o}`;
          return (
            <div key={o} className="flex items-start gap-3">
              <Checkbox
                id={id}
                checked={list.includes(o)}
                onCheckedChange={(on) => {
                  onChange(on === true ? [...list, o] : list.filter((x) => x !== o));
                }}
              />
              <Label htmlFor={id} className="font-normal">
                {o}
              </Label>
            </div>
          );
        })}
      </div>
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
      <Textarea
        value={text}
        maxLength={1000}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        {...named}
      />
    );
  }
  const types: Record<string, string> = {
    number: 'number',
    date: 'date',
    time: 'time',
    datetime: 'datetime-local',
    email: 'email',
  };
  return (
    <Input
      type={types[q.kind] ?? 'text'}
      value={q.kind === 'datetime' && text ? toLocal(text) : text}
      maxLength={q.kind === 'short_text' || q.kind === 'place' ? 200 : undefined}
      onChange={(e) => {
        const v = e.target.value;
        onChange(q.kind === 'datetime' && v ? new Date(v).toISOString() : v);
      }}
      {...named}
    />
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
  heading,
  onEmail,
  onConsent,
}: {
  form: Form;
  wrote: boolean;
  email: string;
  consent: boolean;
  problem: string | null;
  heading: RefObject<HTMLHeadingElement | null>;
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
  return (
    <div className="space-y-4">
      <Field>
        <h2 ref={heading} tabIndex={-1} className="font-display text-2xl font-bold">
          <Label className="text-2xl font-bold" optional={!always && !wrote}>
            Your email address
          </Label>
        </h2>
        <FieldDescription>{why}</FieldDescription>
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            onEmail(e.target.value);
          }}
        />
        <FieldError>{problem}</FieldError>
      </Field>
      {/* On a form for reaching the site, sending it IS asking for a reply. */}
      {reply ? null : (
        <div className="flex items-start gap-3">
          <Checkbox
            id="list-consent"
            checked={consent}
            onCheckedChange={(on) => {
              onConsent(on === true);
            }}
          />
          <div className="flex flex-col">
            <Label htmlFor="list-consent" className="font-normal">
              You may write back to me about this
            </Label>
            <span className="text-sm text-ink-alt">
              Only about what you sent. Not a newsletter, and not passed to anybody.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
