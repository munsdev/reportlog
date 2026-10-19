/**
 * The filing form for one logbook: one card per question.
 *
 * ONE CARD ASKS ONE QUESTION, and nothing on the card in front of somebody
 * changes underneath them. There is no auto-advance: choosing an answer
 * never moves anybody on, Next does. Which cards come next is worked out
 * when Next is pressed, from the answers given so far (walk.ts), so a
 * question an answer turns on appears as the NEXT card, never on this one.
 *
 * The cards, in order:
 *   the opening card       what this logbook is, and that it is a few questions
 *   the logbook's own      one per question being asked
 *   the publication card   its wording and digest come from the server
 *   where to reach you     the address the confirmation link goes to
 *   check your answers     every answer, each one changeable, and the statement
 *
 * ON A DOOR this page may call only the filing calls: the logbook's form, the
 * publication card and sending. It asks for nothing else, so it works on a
 * site behind its password for a logbook opened outside it.
 */
import {
  getIntakeSwitch,
  getPublicLogbook,
  getPublicationCard,
  submitReport,
} from '@reportlog/contracts';
import type { FormQuestion, PublicationCard } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Field, FieldDescription, FieldError } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
import { RadioGroup, RadioOption } from '@/components/ui/radio-group.tsx';
import { ApiRequestError, call } from '@/lib/api.ts';
import { QuestionControl } from './QuestionControl.tsx';
import { askedQuestions, cardProblem, shownAnswer, stillPossible, toSubmission } from './walk.ts';
import type { RawAnswers, RawValue } from './walk.ts';

export const publicLogbookQuery = (slug: string) =>
  queryOptions({
    queryKey: ['logbook', 'public', slug],
    queryFn: ({ signal }) => call(getPublicLogbook, { params: { slug }, signal }),
    retry: false,
  });

export const publicationCardQuery = queryOptions({
  queryKey: ['publication-card', 'general'],
  queryFn: ({ signal }) => call(getPublicationCard, { query: { variant: 'general' }, signal }),
  staleTime: Infinity,
});

const intakeSwitchQuery = queryOptions({
  queryKey: ['intake-switch'],
  queryFn: ({ signal }) => call(getIntakeSwitch, { signal }),
});

/** The statement on the last card. Not sealed: what is sealed is the report. */
export const STATEMENT =
  'I confirm this report is accurate to the best of my knowledge, and I agree to it being stored and processed as this page describes.';

const looksLikeEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

type Step = 'intro' | 'publish' | 'contact' | 'review' | `q:${string}`;

export function FilingForm({ slug }: { slug: string }) {
  const logbook = useQuery(publicLogbookQuery(slug));
  const card = useQuery(publicationCardQuery);
  // Asked on a door too: the door lets this one call through, so the form
  // can say the site is closed before anybody starts writing.
  const intake = useQuery(intakeSwitchQuery);

  if (logbook.isPending) return <p role="status">Loading the form…</p>;
  if (logbook.isError) {
    const missing = logbook.error instanceof ApiRequestError && logbook.error.status === 404;
    return (
      <Page
        title={missing ? 'There is no logbook here' : 'This form could not be loaded'}
        width="prose"
      >
        <p>
          {missing
            ? 'Check the address you were given. It may have a typing mistake in it.'
            : logbook.error.message}
        </p>
      </Page>
    );
  }
  const lb = logbook.data;
  if (!lb.accepting) {
    return (
      <Page title={lb.title} width="prose">
        <Alert
          title={
            lb.state === 'scheduled' ? 'This logbook has not opened yet' : 'This logbook is closed'
          }
        >
          {lb.state === 'scheduled' && lb.opens_at
            ? `It opens on ${new Date(lb.opens_at).toLocaleString()}.`
            : 'It is not taking reports.'}
        </Alert>
      </Page>
    );
  }
  if (intake.data?.open === false) {
    return (
      <Page title={lb.title} width="prose">
        <Alert title="This site is not taking reports at the moment">
          Nothing you type here could be sent. Please come back later.
        </Alert>
      </Page>
    );
  }
  return (
    <Cards
      slug={lb.slug}
      title={lb.title}
      blurb={lb.blurb}
      questions={lb.fields}
      card={card.data}
      cardError={card.isError}
    />
  );
}

function Cards({
  slug,
  title,
  blurb,
  questions,
  card,
  cardError,
}: {
  slug: string;
  title: string;
  blurb: string | null;
  questions: FormQuestion[];
  card: PublicationCard | undefined;
  cardError: boolean;
}) {
  const [raw, setRaw] = useState<RawAnswers>({});
  const [publish, setPublish] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [step, setStep] = useState<Step>('intro');
  const [backToReview, setBackToReview] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () =>
      call(submitReport, {
        body: {
          logbook: slug,
          email: email.trim(),
          consent,
          answers: toSubmission(questions, raw),
          // Not answering is "no", and the card said so before anybody acted.
          may_publish: publish === 'yes',
          may_publish_digest: card?.digest ?? '',
        },
      }),
  });

  const asked = useMemo(() => askedQuestions(questions, raw), [questions, raw]);
  const steps: Step[] = [
    'intro',
    ...asked.map((q): Step => `q:${q.key}`),
    'publish',
    'contact',
    'review',
  ];
  const dirty = Object.keys(raw).length > 0 || email !== '' || publish !== '';

  // Leaving the page loses everything typed. Ask first, until it is sent.
  useEffect(() => {
    if (!dirty || send.isSuccess) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty, send.isSuccess]);

  if (send.isSuccess) return <SentReceipt email={email.trim()} title={title} />;

  const question = step.startsWith('q:') ? questions.find((q) => `q:${q.key}` === step) : undefined;
  const at = Math.max(0, steps.indexOf(step));

  const problemHere = (): string | null => {
    if (question) return cardProblem(question, raw);
    if (step === 'publish' && !card)
      return 'This question has not loaded yet. Try again in a moment.';
    if (step === 'contact' && !looksLikeEmail(email))
      return 'Enter an email address we can reach you at.';
    return null;
  };
  const go = (to: Step) => {
    setProblem(null);
    setStep(to);
  };
  const next = () => {
    const p = problemHere();
    if (p) {
      setProblem(p);
      return;
    }
    if (backToReview) {
      setBackToReview(false);
      go('review');
      return;
    }
    // Worked out NOW, from the answers given so far: a question this answer
    // turned on is the next card.
    const now = [
      'intro',
      ...askedQuestions(questions, raw).map((q) => `q:${q.key}`),
      'publish',
      'contact',
      'review',
    ] as Step[];
    go(now[now.indexOf(step) + 1] ?? 'review');
  };
  const back = () => {
    setBackToReview(false);
    go(steps[at - 1] ?? 'intro');
  };

  // Measured against every question that could STILL be asked, so on the
  // way forward the bar only ever advances. No numbers: a total that changes
  // as you answer reads as a trap.
  const possible = questions.filter((q) => stillPossible(q, questions, raw)).length + 3;
  const progress = step === 'intro' ? null : Math.round((at / possible) * 100);

  return (
    <section className="mx-auto flex max-w-prose flex-col gap-6">
      <p className="text-sm font-semibold text-ink-alt">{title}</p>
      {progress !== null ? (
        <div
          role="progressbar"
          aria-label="How far through the form"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(progress, 100)}
          className="h-2 w-full overflow-hidden rounded-full bg-paper-alt"
        >
          <div className="h-full bg-ink" style={{ width: `${String(Math.min(progress, 100))}%` }} />
        </div>
      ) : null}

      {step === 'intro' ? (
        <CardShell heading={title} step={step}>
          {blurb ? <p className="whitespace-pre-wrap">{blurb}</p> : null}
          <p>
            A few questions, one at a time. How many depends on your answers. Most people take a few
            minutes. Nothing is sent until the last card, and nothing is filed until you confirm it
            from your email.
          </p>
        </CardShell>
      ) : null}

      {question ? (
        <QuestionCard
          key={question.key}
          question={question}
          value={raw[question.key]}
          onChange={(v) => {
            setProblem(null);
            setRaw((r) => ({ ...r, [question.key]: v }));
          }}
          problem={problem}
        />
      ) : null}

      {step === 'publish' ? (
        <PublishCard card={card} failed={cardError} value={publish} onChange={setPublish} />
      ) : null}

      {step === 'contact' ? (
        <CardShell heading="Where can we reach you?" step={step}>
          <Field>
            <Label>Your email address</Label>
            <FieldDescription>
              We send a link there to confirm the report is really from you. Nothing is filed until
              you open it. Your address is never published and is not part of the report.
            </FieldDescription>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setProblem(null);
                setEmail(e.target.value);
              }}
            />
            <FieldError>{problem}</FieldError>
          </Field>
        </CardShell>
      ) : null}

      {step === 'review' ? (
        <CardShell heading="Check your answers" step={step}>
          <p>Nothing is filed until you confirm it from your email. Check it over first.</p>
          <dl className="divide-y divide-line rounded-card border border-line">
            {asked.map((q) => (
              <ReviewRow
                key={q.key}
                label={q.label}
                value={shownAnswer(q, raw) ?? (q.required ? null : '—')}
                onChange={() => {
                  setBackToReview(true);
                  go(`q:${q.key}`);
                }}
              />
            ))}
            <ReviewRow
              label="Published if approved"
              value={publish === 'yes' ? (card?.options.yes ?? 'Yes') : (card?.options.no ?? 'No')}
              onChange={() => {
                setBackToReview(true);
                go('publish');
              }}
            />
            <ReviewRow
              label="Your email address"
              value={email.trim() || null}
              onChange={() => {
                setBackToReview(true);
                go('contact');
              }}
            />
          </dl>
          <div className="flex items-start gap-3">
            <Checkbox
              id="filing-statement"
              checked={consent}
              onCheckedChange={(on) => {
                setProblem(null);
                setConsent(on === true);
              }}
            />
            <Label htmlFor="filing-statement" className="font-normal">
              {STATEMENT}
            </Label>
          </div>
          {problem ? <Alert tone="serious" title={problem} /> : null}
          {send.isError ? (
            <Alert tone="serious" title="The report was not sent">
              {send.error.message}
            </Alert>
          ) : null}
        </CardShell>
      ) : null}

      {problem && step !== 'review' && step !== 'contact' && !question ? (
        <Alert tone="serious" title={problem} />
      ) : null}

      <div className="flex items-center justify-between gap-3">
        {at > 0 ? (
          <Button type="button" variant="secondary" onClick={back}>
            Back
          </Button>
        ) : (
          <span />
        )}
        {step === 'review' ? (
          <Button
            type="button"
            disabled={send.isPending}
            onClick={() => {
              if (!consent) {
                setProblem('Confirm the statement above to send the report.');
                return;
              }
              const missing = asked.find((q) => cardProblem(q, raw));
              if (missing) {
                setProblem(`“${missing.label}” needs an answer. Press Change beside it.`);
                return;
              }
              send.mutate();
            }}
          >
            {send.isPending ? 'Sending…' : 'Send report'}
          </Button>
        ) : (
          <Button type="button" onClick={next}>
            {step === 'intro' ? 'Start' : 'Next'}
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * A card. Its heading takes focus when it appears, because the page does not
 * reload between questions and nothing else would tell a screen reader that
 * the content changed. The tab title names the card for the same reason.
 */
function CardShell({
  heading,
  step,
  help,
  headingId,
  children,
}: {
  heading: string;
  step: string;
  help?: ReactNode;
  headingId?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
    window.scrollTo(0, 0);
  }, [step]);
  return (
    <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
      <h1
        ref={ref}
        id={headingId}
        tabIndex={-1}
        className="font-display text-2xl font-bold outline-none"
      >
        {heading}
      </h1>
      {help}
      {children}
    </div>
  );
}

function QuestionCard({
  question,
  value,
  onChange,
  problem,
}: {
  question: FormQuestion;
  value: RawValue | undefined;
  onChange: (v: RawValue) => void;
  problem: string | null;
}) {
  const id = useId();
  const headingId = `${id}-q`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <CardShell
      heading={question.label}
      step={question.key}
      headingId={headingId}
      help={
        <div id={helpId} className="flex flex-col gap-1 text-ink-alt">
          {question.help ? <p className="whitespace-pre-wrap">{question.help}</p> : null}
          {question.required ? null : <p className="text-sm">Optional.</p>}
        </div>
      }
    >
      <QuestionControl
        question={question}
        value={value}
        onChange={onChange}
        labelledBy={headingId}
        describedBy={[helpId, problem ? errorId : ''].filter(Boolean).join(' ')}
        invalid={Boolean(problem)}
      />
      {problem ? (
        <p id={errorId} role="alert" className="flex gap-1.5 text-sm font-semibold text-serious">
          <span aria-hidden="true">!</span>
          <span>
            <span className="sr-only">Error:</span> {problem}
          </span>
        </p>
      ) : null}
    </CardShell>
  );
}

/**
 * The publication question, in the server's words. The digest of exactly
 * these words is sealed beside the answer, so the page holds no copy of its
 * own. Optional, and the card says what not answering means BEFORE anybody
 * acts.
 */
function PublishCard({
  card,
  failed,
  value,
  onChange,
}: {
  card: PublicationCard | undefined;
  failed: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  if (!card) {
    return (
      <CardShell heading="Should this report be published?" step="publish">
        <p role="status">
          {failed
            ? 'This question could not be loaded. Reload the page.'
            : 'Loading this question…'}
        </p>
      </CardShell>
    );
  }
  return (
    <CardShell heading={card.question} step="publish" headingId={`${id}-q`}>
      {card.body.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <p className="font-semibold">{card.optionality}</p>
      <RadioGroup value={value} onValueChange={onChange} aria-labelledby={`${id}-q`}>
        <RadioOption value="yes" label={card.options.yes} />
        <RadioOption value="no" label={card.options.no} />
      </RadioGroup>
    </CardShell>
  );
}

function ReviewRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <dt className="text-sm font-semibold text-ink-alt">{label}</dt>
        <dd className="whitespace-pre-wrap">
          {value ?? <span className="font-semibold text-serious">Not answered</span>}
        </dd>
      </div>
      <Button
        type="button"
        variant="quiet"
        size="sm"
        onClick={onChange}
        aria-label={`Change: ${label}`}
      >
        Change
      </Button>
    </div>
  );
}

function SentReceipt({ email, title }: { email: string; title: string }) {
  return (
    <Page title="Check your email" width="prose">
      <Alert tone="confirmed" title={`We have sent a link to ${email}`}>
        Open it and press “Confirm and file my report”. Nothing is filed in “{title}” until you do.
        The link works for 24 hours.
      </Alert>
      <p>If nothing arrives in a few minutes, look in your spam folder.</p>
    </Page>
  );
}
