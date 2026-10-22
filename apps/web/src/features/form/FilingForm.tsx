/**
 * The filing form for one logbook: one card per question.
 *
 * ONE CARD ASKS ONE QUESTION, and nothing on the card in front of somebody
 * changes underneath them. There is no auto-advance: choosing an answer
 * never moves anybody on, Next does. Which cards come next is worked out
 * when Next is pressed, from the answers given so far (walk.ts), so a
 * question an answer turns on appears as the NEXT card, never on this one.
 * Each card is an entry in the browser's history (cardHistory.ts), so the
 * browser's Back goes back one question, as it did in the old form.
 *
 * The cards, in order:
 *   the opening card       what this logbook is, the emergency notice, what
 *                          happens next, and Start
 *   the logbook's own      one per question being asked
 *   the publication card   its wording and digest come from the server
 *   where to reach you     the address the confirmation link goes to. ONLY
 *                          where the logbook asks for one (owner decision
 *                          E1: a question somebody types into, files, or
 *                          the operator's switch). Without it the report is
 *                          sealed on arrival and there is no link to follow
 *   files                  only when the logbook asks for files (files
 *                          workstream). AFTER the address wherever the
 *                          operator put the question, because the server's
 *                          staging quota is keyed on the address
 *   check your answers     every answer, each one changeable, and the statement
 *
 * Every card wears the same frame (CardFrame.tsx): the logbook as the
 * eyebrow, the question as the page's heading, Back and Next in a bar fixed
 * to the bottom of a phone's screen. Next is never disabled: on a card that
 * needs an answer it says so instead.
 *
 * AT THE DOOR (features/door/): a start token as the form opens, a puzzle
 * solved in the background before Send works, and a box nobody can see.
 *
 * ON A DOOR this page may call only the filing calls: the logbook's form, the
 * publication card and sending, the door's two reads, and, only for a logbook
 * that asks for files, the upload calls. It asks for nothing else, so it works
 * on a site behind its password for a logbook opened outside it. The
 * emergency notice comes with the logbook's form for that reason.
 */
import {
  getUploadConfig,
  getIntakeSwitch,
  getPublicLogbook,
  getPublicationCard,
  submitReport,
} from '@reportlog/contracts';
import type { FormQuestion, PublicationCard } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';
import type { RouterHistory } from '@tanstack/react-router';
import { cardHeading, cardsOf, helpFor } from '@reportlog/fields';
import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { CheckOption } from '@/components/ui/choice.tsx';
import { CopyText } from '@/components/ui/copy-text.tsx';
import { Count } from '@/components/ui/count.tsx';
import { Field, FieldDescription } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { RadioGroup, RadioOption } from '@/components/ui/radio-group.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { Eyebrow, Lede, Meta } from '@/components/ui/type.tsx';
import {
  DoorPuzzle,
  Honeypot,
  doorStatus,
  useDoor,
  useSendWhenReady,
} from '@/features/door/useDoor.tsx';
import { FilePicker, useFilingTarget } from '@/features/files/FilesCard.tsx';
import { useUploader } from '@/features/files/uploader.ts';
import { useGateMode } from '@/features/identity/gateMode.ts';
import { ApiRequestError, call } from '@/lib/api.ts';
import { PausedForm, useIntakePaused } from '../flood/IntakePaused.tsx';
import { CardBar, CardFrame, FilingProgress, useCardTitle, useFocusOnMount } from './CardFrame.tsx';
import { useCardHistory } from './cardHistory.ts';
import type { CardEntry } from './cardHistory.ts';
import { FormColumn, FormNotice } from './FormNotice.tsx';
import { HelpNow } from './HelpNow.tsx';
import { QuestionControl, kindHelp } from './QuestionControl.tsx';
import { TipOffer, rememberForTip } from './tipOffer.tsx';
import {
  askedCards,
  askedQuestions,
  cardProblem,
  everyCardId,
  sealedAnswers,
  shownAnswer,
  stillPossible,
  toSubmission,
  withChange,
} from './walk.ts';
import type { RawAnswers, RawValue } from './walk.ts';
import { HeaderProgress } from '../nav/progress.tsx';

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

type Step = 'intro' | 'publish' | 'contact' | 'files' | 'review' | `q:${string}`;

export function FilingForm({ slug, history }: { slug: string; history?: RouterHistory }) {
  const logbook = useQuery(publicLogbookQuery(slug));
  const card = useQuery(publicationCardQuery);
  // Asked on a door too: the door lets this one call through, so the form
  // can say the site is closed before anybody starts writing.
  const intake = useQuery(intakeSwitchQuery);
  const paused = useIntakePaused();

  if (logbook.isPending) {
    return (
      <FormColumn>
        <p role="status">Loading the form…</p>
      </FormColumn>
    );
  }
  if (logbook.isError) {
    const missing = logbook.error instanceof ApiRequestError && logbook.error.status === 404;
    return (
      <FormNotice title={missing ? 'There is no logbook here' : 'This form could not be loaded'}>
        {missing ? (
          <p className="max-w-prose">
            Check the address you were given. It may have a typing mistake in it.
          </p>
        ) : (
          <Alert tone="serious" title="The form did not load">
            {logbook.error.message}
          </Alert>
        )}
      </FormNotice>
    );
  }
  const lb = logbook.data;
  if (!lb.accepting) {
    return (
      <FormNotice title={lb.title}>
        <Card variant="quiet">
          <p className="max-w-prose">
            {lb.state !== 'scheduled'
              ? 'This logbook is closed. It is not taking reports.'
              : lb.opens_at
                ? `This logbook has not opened yet. It opens on ${new Date(lb.opens_at).toLocaleString()}.`
                : 'This logbook has not opened yet.'}
          </p>
        </Card>
      </FormNotice>
    );
  }
  // Plan E: a moderator paused intake (features/flood).
  if (paused) return <PausedForm title={lb.title} />;
  if (intake.data?.open === false) {
    return (
      <FormNotice title={lb.title}>
        <Card variant="quiet">
          <p className="max-w-prose">
            This site is not taking reports at the moment. Nothing you type here could be sent.
            Please come back later.
          </p>
        </Card>
      </FormNotice>
    );
  }
  return (
    <Cards
      slug={lb.slug}
      title={lb.title}
      blurb={lb.blurb}
      helpNow={lb.help_now}
      questions={lb.fields}
      form={lb.form}
      asksEmail={lb.asks_email}
      card={card.data}
      cardError={card.isError}
      retryCard={() => {
        void card.refetch();
      }}
      history={history}
    />
  );
}

function Cards({
  slug,
  title,
  blurb,
  helpNow,
  questions,
  form,
  asksEmail,
  card,
  cardError,
  retryCard,
  history,
}: {
  slug: string;
  title: string;
  blurb: string | null;
  /** The emergency notice (decision 62), sent with the form so a door has it. */
  helpNow: string;
  questions: FormQuestion[];
  /** Whether this logbook asks for an address at all (E1). */
  asksEmail: boolean;
  /** The version these questions are; sealed if only wording changes before Send. */
  form?: string | undefined;
  card: PublicationCard | undefined;
  cardError: boolean;
  retryCard: () => void;
  history: RouterHistory | undefined;
}) {
  const [raw, setRaw] = useState<RawAnswers>({});
  const [publish, setPublish] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [step, setStep] = useState<Step>('intro');
  const [backToReview, setBackToReview] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Files, only where the logbook asks for them: on a door the upload calls
  // pass for such a logbook and no other.
  const fileQuestion = questions.find((q) => q.kind === 'file');
  const uploadConfig = useQuery({
    queryKey: ['upload-config', slug],
    queryFn: ({ signal }) => call(getUploadConfig, { query: { logbook: slug }, signal }),
    enabled: Boolean(fileQuestion),
  });
  const takesFiles = Boolean(fileQuestion && uploadConfig.data?.enabled);
  const target = useFilingTarget(slug, email);
  const uploader = useUploader(takesFiles ? target : null);
  const draft = target.draft();
  const door = useDoor();
  const send = useMutation({
    onSuccess: () => {
      rememberForTip(toSubmission(questions, raw));
    },
    // A solution is good for one send, accepted or refused.
    onError: () => {
      door.renew();
    },
    mutationFn: () =>
      call(submitReport, {
        body: {
          logbook: slug,
          ...(asksEmail ? { email: email.trim() } : {}),
          ...door.fields(),
          consent,
          answers: toSubmission(questions, raw),
          // Not answering is "no", and the card said so before anybody acted.
          may_publish: publish === 'yes',
          may_publish_digest: card?.digest ?? '',
          ...(draft && uploader.kept.length ? { draft_token: draft } : {}),
          ...(form ? { form } : {}),
        },
      }),
  });

  const sending = useSendWhenReady(door, send);

  const asked = useMemo(() => askedQuestions(questions, raw), [questions, raw]);
  // ONE STEP PER CARD. Most cards ask one question; a card whose question has
  // parts (a state and its county, a day and its hour) asks them together.
  const cardOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cardsOf(questions)) for (const q of c) m.set(q.key, c[0]?.key ?? q.key);
    return m;
  }, [questions]);
  const steps: Step[] = [
    'intro',
    ...askedCards(questions, raw).map((c): Step => `q:${c.id}`),
    'publish',
    ...(asksEmail ? (['contact'] as Step[]) : []),
    ...(takesFiles ? (['files'] as Step[]) : []),
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

  // Every card there could be, in order: where to fall back to when the
  // browser returns to a card the answers since have stopped asking.
  const everyStep: Step[] = [
    'intro',
    ...everyCardId(questions).map((id): Step => `q:${id}`),
    'publish',
    'contact',
    'files',
    'review',
  ];
  const cards = useCardHistory(history, 'intro', (entry: CardEntry | null) => {
    setProblem(null);
    const wanted = (entry?.card ?? 'intro') as Step;
    if (entry && steps.includes(wanted)) {
      setStep(wanted);
      setBackToReview(entry.toReview);
      return null;
    }
    // An entry from before a reload has no answers behind it, so the form
    // starts again; a card no longer asked gives way to the one before it.
    const before = everyStep.slice(0, Math.max(0, everyStep.indexOf(wanted)));
    const instead = entry ? (before.reverse().find((s) => steps.includes(s)) ?? 'intro') : 'intro';
    setStep(instead);
    setBackToReview(false);
    return { card: instead, toReview: false };
  });

  const shownCard = step.startsWith('q:')
    ? askedCards(questions, raw).find((c) => `q:${c.id}` === step)
    : undefined;
  const shownHeading = shownCard
    ? cardHeading(cardsOf(questions).find((c) => c[0]?.key === shownCard.id) ?? shownCard.parts)
    : '';
  const at = Math.max(0, steps.indexOf(step));

  // Measured against every question that could STILL be asked, so on the
  // way forward the rule only ever advances. No numbers on the page: a total
  // that changes as you answer reads as a trap. The files card counts until
  // the server has said the logbook takes none: its answer arriving late may
  // only move the rule on, never back.
  const sealed = sealedAnswers(questions, raw);
  const mayTakeFiles = Boolean(fileQuestion) && uploadConfig.data?.enabled !== false;
  const possible =
    cardsOf(questions).filter((c) => c.some((q) => stillPossible(q, questions, raw, sealed)))
      .length +
    (mayTakeFiles ? 4 : 3) -
    (asksEmail ? 0 : 1);
  const progress = send.isSuccess || step === 'intro' ? null : Math.min(1, at / possible);

  // The tab title (filing.md §02): the question, where it is among the cards
  // still possible (the opening card not counted), and the site.
  const tabHeading: Record<string, string> = {
    intro: title,
    review: 'Check your answers',
    publish: card?.question ?? 'Should this report be published?',
    contact: 'Where can we reach you?',
    files: fileQuestion?.label ?? 'Files',
  };
  useCardTitle(
    send.isSuccess ? 'Your report was sent' : (tabHeading[step] ?? shownHeading),
    send.isSuccess || step === 'intro' || step === 'review' ? null : { n: at, of: possible - 1 },
  );

  if (send.isSuccess) {
    return (
      <FormColumn>
        {'filed' in send.data ? (
          <FiledReceipt title={title} />
        ) : (
          <SentReceipt email={email.trim()} title={title} />
        )}
      </FormColumn>
    );
  }

  const problemHere = (): string | null => {
    if (shownCard) {
      for (const part of shownCard.parts) {
        const p = cardProblem(part, raw, questions);
        if (p) return shownCard.parts.length > 1 ? `${part.label}: ${p}` : p;
      }
      return null;
    }
    if (step === 'publish' && !card)
      return cardError
        ? 'The wording of this question did not load. Press Try again.'
        : 'The wording of this question has not loaded yet. Wait a moment, then press Next again.';
    if (step === 'contact' && !looksLikeEmail(email))
      return 'Enter an email address we can reach you at.';
    if (step === 'files' && fileQuestion?.required && !uploader.kept.length)
      return 'Attach at least one file.';
    return null;
  };
  const go = (to: Step, toReview = false) => {
    setProblem(null);
    setBackToReview(toReview);
    setStep(to);
    cards.push({ card: to, toReview });
  };
  const next = () => {
    const p = problemHere();
    if (p) {
      setProblem(p);
      return;
    }
    if (backToReview) {
      go('review');
      return;
    }
    // Worked out NOW, from the answers given so far: a question this answer
    // turned on is the next card.
    const now = [
      'intro',
      ...askedCards(questions, raw).map((c) => `q:${c.id}`),
      'publish',
      ...(asksEmail ? ['contact'] : []),
      ...(takesFiles ? ['files'] : []),
      'review',
    ] as Step[];
    go(now[now.indexOf(step) + 1] ?? 'review');
  };
  // Where the browser's Back would go: after "Change", that is the review.
  // On the first question it is the opening card.
  const back = () => {
    if (cards.back) cards.back();
    else go(steps[at - 1] ?? 'intro');
  };
  const sendNow = () => {
    if (!consent) {
      setProblem('Tick the statement above to send the report.');
      return;
    }
    const missing = asked.find((q) => cardProblem(q, raw, questions));
    if (missing) {
      setProblem(`“${missing.label}” needs an answer. Press Change beside it.`);
      return;
    }
    if (uploader.busy) {
      setProblem('Wait until your files have finished sending, then send the report.');
      return;
    }
    // Pressed before the door is ready, it goes when it is; the door's
    // status line above the button says what it is waiting for.
    setProblem(null);
    sending.press();
  };

  return (
    <FormColumn>
      <Honeypot door={door} />
      <DoorPuzzle door={door} />
      {/* The header rule takes a percentage; progress here is a fraction. */}
      <HeaderProgress percent={progress === null ? null : Math.round(progress * 100)} />
      <FilingProgress value={progress} />

      {step === 'intro' ? (
        <OpeningCard
          title={title}
          blurb={blurb}
          helpNow={helpNow}
          asksEmail={asksEmail}
          onStart={next}
        />
      ) : null}

      {shownCard ? (
        <QuestionCard
          key={shownCard.id}
          eyebrow={title}
          parts={shownCard.parts}
          heading={shownHeading}
          help={helpFor(
            questions.find((q) => q.key === shownCard.id) ?? shownCard.parts[0] ?? { help: null },
            sealed,
          )}
          raw={raw}
          answers={sealed}
          onChange={(key, v) => {
            setProblem(null);
            setRaw((r) => withChange(questions, r, key, v));
          }}
          problem={problem}
        />
      ) : null}

      {step === 'publish' ? (
        <PublishCard
          eyebrow={title}
          card={card}
          failed={cardError}
          onRetry={retryCard}
          value={publish}
          onChange={(v) => {
            setProblem(null);
            setPublish(v);
          }}
          problem={problem}
        />
      ) : null}

      {step === 'contact' ? (
        <CardFrame
          eyebrow={title}
          heading="Where can we reach you?"
          focusKey={step}
          error={problem}
          errorId="contact-error"
        >
          <Field>
            <Label>Your email address</Label>
            <FieldDescription>
              We send a link there to confirm the report is really from you. Nothing is filed until
              you open it. Your address is never published and is not part of the report.
            </FieldDescription>
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              aria-describedby={problem ? 'contact-error' : undefined}
              aria-invalid={problem ? true : undefined}
              onChange={(e) => {
                setProblem(null);
                setEmail(e.target.value);
              }}
            />
          </Field>
        </CardFrame>
      ) : null}

      {step === 'files' && fileQuestion && uploadConfig.data ? (
        <CardFrame
          eyebrow={title}
          heading={fileQuestion.label}
          focusKey={step}
          headingId="files-card-heading"
          optional={!fileQuestion.required}
          help={
            fileQuestion.help ? (
              <p className="max-w-prose whitespace-pre-wrap text-ink-alt">{fileQuestion.help}</p>
            ) : null
          }
          error={problem}
        >
          <FilePicker
            config={uploadConfig.data}
            uploader={uploader}
            labelledBy="files-card-heading"
          />
        </CardFrame>
      ) : null}

      {step === 'review' ? (
        <CardFrame eyebrow={title} heading="Check your answers" focusKey={step}>
          <p className="max-w-prose">
            {asksEmail
              ? 'Nothing is filed until you confirm it from your email. Check it over first.'
              : 'Your report is filed the moment you send it, and you cannot come back to it. Check it over first.'}
          </p>
          <dl className="flex flex-col divide-y divide-line border-y border-line">
            {asked.map((q) => (
              <ReviewRow
                key={q.key}
                label={q.label}
                value={shownAnswer(q, raw, questions)}
                required={q.required}
                onChange={() => {
                  go(`q:${cardOf.get(q.key) ?? q.key}`, true);
                }}
              />
            ))}
            <ReviewRow
              label="Published if approved"
              value={publish === 'yes' ? (card?.options.yes ?? 'Yes') : (card?.options.no ?? 'No')}
              required
              onChange={() => {
                go('publish', true);
              }}
            />
            {takesFiles && fileQuestion ? (
              <ReviewRow
                label={fileQuestion.label}
                value={uploader.kept.length ? uploader.kept.map((f) => f.name).join(', ') : null}
                required={fileQuestion.required}
                onChange={() => {
                  go('files', true);
                }}
              />
            ) : null}
            {asksEmail ? (
              <ReviewRow
                label="Your email address"
                value={email.trim() || null}
                required
                onChange={() => {
                  go('contact', true);
                }}
              />
            ) : null}
          </dl>
          <CheckOption
            id="filing-statement"
            checked={consent}
            onCheckedChange={(on) => {
              setProblem(null);
              setConsent(on === true);
            }}
            label={STATEMENT}
          />
          {/* The operator's own line about sending, when they wrote one. */}
          <CopyText slot="send_note" className="font-semibold" />
          <Card variant="deep" className="gap-1">
            {asksEmail ? (
              <p className="font-semibold">
                Nothing is filed until you confirm it from your email.
              </p>
            ) : (
              <>
                <p className="font-semibold">
                  This report can’t be changed or withdrawn after you send it.
                </p>
                <p className="text-on-deep-muted">
                  It is sealed the moment it arrives. A moderator reads it before anything is
                  public.
                </p>
              </>
            )}
          </Card>
        </CardFrame>
      ) : null}

      {step === 'intro' ? null : (
        <CardBar
          onBack={back}
          primary={step === 'review' ? 'Send report' : 'Next'}
          onPrimary={step === 'review' ? sendNow : next}
          busy={step === 'review' && (send.isPending || sending.waiting)}
          busyLabel="Sending…"
          above={
            step === 'review' ? (
              <ReviewMessages
                problem={problem}
                failure={send.isError ? send.error.message : null}
                status={doorStatus(door)}
              />
            ) : null
          }
        />
      )}
    </FormColumn>
  );
}

/**
 * What the review card needs said above its button: a problem with the
 * answers, a refusal, or the door still getting ready. A problem takes
 * focus, so somebody who pressed Send hears why nothing happened; the
 * answers stay as they were.
 */
function ReviewMessages({
  problem,
  failure,
  status,
}: {
  problem: string | null;
  failure: string | null;
  status: string | null;
}) {
  return (
    <>
      {problem ? <FocusedAlert key={problem} title={problem} /> : null}
      {failure ? (
        <FocusedAlert key={failure} title="The report was not sent" body={failure} />
      ) : null}
      {status ? (
        <p role="status" className="text-sm text-ink-alt">
          {status}
        </p>
      ) : null}
    </>
  );
}

function FocusedAlert({ title, body }: { title: string; body?: string }) {
  const ref = useFocusOnMount<HTMLDivElement>();
  return (
    <Alert ref={ref} tone="serious" title={title} tabIndex={-1} className="outline-none">
      {body}
    </Alert>
  );
}

/**
 * The logbook's opening card (filing.md §03): what it is, the emergency
 * notice, what happens next, and Start. No progress rule here.
 */
function OpeningCard({
  title,
  blurb,
  helpNow,
  asksEmail,
  onStart,
}: {
  title: string;
  blurb: string | null;
  helpNow: string;
  asksEmail: boolean;
  onStart: () => void;
}) {
  const onDoor = useGateMode() === 'door';
  const site = plainSiteName(useSite().data);
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const lines = [
    'One question at a time. How many depends on your answers.',
    asksEmail
      ? 'You check your answers before you send. Nothing is filed until you confirm it from your email.'
      : 'You check your answers before you send. Once you send it, it is filed as it is.',
    'A moderator reads it before anything is public.',
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Eyebrow>File a report</Eyebrow>
        <h1 ref={heading} tabIndex={-1} className="font-display text-title outline-none">
          {title}
        </h1>
        {blurb ? <Lede className="whitespace-pre-wrap">{blurb}</Lede> : null}
      </div>
      <HelpNow text={helpNow} />
      <section aria-labelledby="what-happens" className="flex flex-col gap-3">
        <h2 id="what-happens" className="label-face text-xs text-muted">
          What happens next
        </h2>
        <ol className="flex flex-col gap-2.5">
          {lines.map((line, i) => (
            <li key={line} className="flex items-start gap-3">
              {/* The list already numbers it for a screen reader. */}
              <Count value={i + 1} label="" aria-hidden="true" className="mt-0.5" />
              <span className="max-w-prose">{line}</span>
            </li>
          ))}
        </ol>
      </section>
      <div className="flex flex-col items-stretch gap-3 sm:items-start">
        <Button size="lg" block className="sm:w-auto" onClick={onStart}>
          Start
        </Button>
        {/* Behind the password on a door, so not offered there. */}
        {onDoor ? null : (
          <Button asChild variant="quiet" className="self-center sm:self-start">
            <a href="/how">How to use {site}</a>
          </Button>
        )}
      </div>
      <Meta className="text-center sm:text-left">Sealed and timestamped on arrival.</Meta>
    </div>
  );
}

/**
 * One card: one question, which may have parts on it (cards.ts in
 * @reportlog/fields). With one part, the heading IS the question and names
 * the control, as it always did. With several, the heading is the card's own
 * question and each part is named by its own label beside its control.
 */
function QuestionCard({
  eyebrow,
  parts,
  heading,
  help,
  raw,
  answers,
  onChange,
  problem,
}: {
  eyebrow: string;
  parts: FormQuestion[];
  heading: string;
  help: string | undefined;
  raw: RawAnswers;
  answers: Record<string, unknown>;
  onChange: (key: string, v: RawValue | undefined) => void;
  problem: string | null;
}) {
  const id = useId();
  const headingId = `${id}-q`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const single = parts.length === 1 ? parts[0] : undefined;
  const sealedSoFar = answers as Parameters<typeof QuestionControl>[0]['answers'];
  // What the kind itself needs said ("Tick everything that applies.", a
  // date's format, whose clock a time is in), unless the wording says it.
  const extra = single ? kindHelp(single, `${heading} ${help ?? ''}`) : null;
  return (
    <CardFrame
      eyebrow={eyebrow}
      heading={heading}
      focusKey={parts[0]?.key ?? ''}
      headingId={headingId}
      optional={Boolean(single && !single.required)}
      help={
        help || extra ? (
          <div id={helpId} className="flex max-w-prose flex-col gap-1 text-ink-alt">
            {help ? <p className="whitespace-pre-wrap">{help}</p> : null}
            {extra ? <p>{extra}</p> : null}
          </div>
        ) : null
      }
      error={problem}
      errorId={errorId}
    >
      {single ? (
        <QuestionControl
          question={single}
          value={raw[single.key]}
          onChange={(v) => {
            onChange(single.key, v);
          }}
          labelledBy={headingId}
          describedBy={
            [help || extra ? helpId : '', problem ? errorId : ''].filter(Boolean).join(' ') ||
            undefined
          }
          invalid={Boolean(problem)}
          answers={sealedSoFar}
          raw={raw}
        />
      ) : (
        <div className="flex flex-col gap-5" role="group" aria-labelledby={headingId}>
          {parts.map((part, i) => {
            const partId = `${id}-part-${String(i)}`;
            // A tick box carries its own label beside the box.
            const box = part.kind === 'yes_no' && part.settings.checkbox === true;
            const partHelp = [i === 0 ? undefined : part.help, kindHelp(part, part.label)]
              .filter(Boolean)
              .join(' ');
            return (
              <div key={part.key} className="flex flex-col gap-1.5">
                {box ? null : (
                  <p id={partId} className="label-face text-[0.8125rem]">
                    {part.label}
                    {part.required ? null : (
                      <span className="font-sans font-normal tracking-normal normal-case text-ink-alt">
                        {' '}
                        Optional.
                      </span>
                    )}
                  </p>
                )}
                {partHelp ? (
                  <p id={`${partId}-help`} className="text-sm text-ink-alt">
                    {partHelp}
                  </p>
                ) : null}
                <QuestionControl
                  question={part}
                  value={raw[part.key]}
                  onChange={(v) => {
                    onChange(part.key, v);
                  }}
                  labelledBy={box ? headingId : partId}
                  describedBy={
                    [partHelp ? `${partId}-help` : '', problem ? errorId : '']
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  invalid={Boolean(problem)}
                  answers={sealedSoFar}
                  raw={raw}
                />
              </div>
            );
          })}
        </div>
      )}
    </CardFrame>
  );
}

/**
 * The publication question, in the server's words. The digest of exactly
 * these words is sealed beside the answer, so the page holds no copy of its
 * own. Optional, and the card says what not answering means BEFORE anybody
 * acts. Until the words arrive the card says so, and Next says why it
 * cannot go on yet; the report cannot be sent without them.
 */
function PublishCard({
  eyebrow,
  card,
  failed,
  onRetry,
  value,
  onChange,
  problem,
}: {
  eyebrow: string;
  card: PublicationCard | undefined;
  failed: boolean;
  onRetry: () => void;
  value: string;
  onChange: (v: string) => void;
  problem: string | null;
}) {
  const id = useId();
  if (!card) {
    return (
      <CardFrame
        eyebrow={eyebrow}
        heading="Should this report be published?"
        focusKey="publish"
        error={problem}
      >
        {failed ? (
          <Alert tone="serious" title="The wording of this question did not load">
            <span className="flex flex-col items-start gap-3">
              <span>The report cannot be sent without it.</span>
              <Button type="button" variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            </span>
          </Alert>
        ) : (
          <p role="status">Loading the wording…</p>
        )}
      </CardFrame>
    );
  }
  return (
    <CardFrame
      eyebrow={eyebrow}
      heading={card.question}
      focusKey="publish"
      headingId={`${id}-q`}
      help={
        <div className="flex max-w-prose flex-col gap-2">
          {card.body.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className="font-semibold">{card.optionality}</p>
        </div>
      }
      error={problem}
    >
      <RadioGroup value={value} onValueChange={onChange} aria-labelledby={`${id}-q`}>
        <RadioOption value="yes" label={card.options.yes} />
        <RadioOption value="no" label={card.options.no} />
      </RadioGroup>
    </CardFrame>
  );
}

function ReviewRow({
  label,
  value,
  required,
  onChange,
}: {
  label: string;
  value: string | null;
  required: boolean;
  onChange: () => void;
}) {
  // A group in a <dl> may hold only its <dt> and <dd>, so the Change button
  // is inside the answer, not beside it.
  return (
    <div className="flex flex-col gap-1 py-3">
      <dt className="label-face text-xs text-ink-alt">{label}</dt>
      <dd className="flex items-start justify-between gap-3">
        <span className="min-w-0 break-words whitespace-pre-wrap">
          {value ??
            (required ? (
              // The cards do not let this happen; said plainly if it ever does.
              <span className="font-semibold text-serious">Not answered</span>
            ) : (
              <span className="text-ink-alt">Not answered</span>
            ))}
        </span>
        <Button
          type="button"
          variant="quiet"
          className="shrink-0"
          onClick={onChange}
          aria-label={`Change: ${label}`}
        >
          Change
        </Button>
      </dd>
    </div>
  );
}

/**
 * Sealed on arrival (E1): nothing to confirm and nothing to come back to. No
 * reference is shown: a reporter is not handed a receipt for a report nobody
 * has yet accepted, and this one has no address to send one to. Quiet, not
 * teal: teal says a moderator confirmed something.
 */
function FiledReceipt({ title }: { title: string }) {
  return (
    <Receipt heading={`Your report to “${title}” was received`}>
      <Alert tone="done">It is sealed. A moderator reads it before anything is public.</Alert>
    </Receipt>
  );
}

function SentReceipt({ email, title }: { email: string; title: string }) {
  return (
    <Receipt heading="Check your email">
      <p className="max-w-prose">
        We have sent a link to <strong className="break-all">{email}</strong>. Nothing is filed in “
        {title}” until you press the button on that page. The link works for 24 hours.
      </p>
      <p className="max-w-prose text-ink-alt">
        If nothing arrives in a few minutes, look in your spam folder.
      </p>
    </Receipt>
  );
}

/** The receipt replaces the form; focus moves to its heading. */
function Receipt({ heading, children }: { heading: string; children: ReactNode }) {
  const onDoor = useGateMode() === 'door';
  const focused = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Eyebrow>File a report</Eyebrow>
        <h1 ref={focused} tabIndex={-1} className="font-display text-title outline-none">
          {heading}
        </h1>
      </div>
      {children}
      <TipOffer />
      {/* Behind the password on a door, so not offered there. */}
      {onDoor ? null : (
        <p className="flex flex-wrap gap-x-2">
          <Button asChild variant="quiet">
            <a href="/">Back to the front page</a>
          </Button>
          <Button asChild variant="quiet">
            <a href="/board">See the live board</a>
          </Button>
        </p>
      )}
    </div>
  );
}
