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
 *   sharing                only when the reporter wrote something or gave a
 *                          link: may vetted journalists read it (G5)
 *   where to reach you     the address the confirmation link goes to. ONLY
 *                          where the logbook asks for one (owner decision
 *                          E1: a question somebody types into, files, or
 *                          the operator's switch), or where the reporter
 *                          wrote something or gave a link (D8: required
 *                          then, and the card says why). Where the operator
 *                          turned the optional card on and nothing was
 *                          written, the card is optional (D8, D20). Without
 *                          an address the report is sealed on arrival and
 *                          there is no link to follow
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
import type { Cover as CoverWords, FormQuestion, PublicationCard } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';
import type { RouterHistory } from '@tanstack/react-router';
import { cardHeading, cardsOf, helpFor } from '@reportlog/fields';
import { useEffect, useId, useMemo, useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { CopyText } from '@/components/ui/copy-text.tsx';
import {
  DoorPuzzle,
  Honeypot,
  doorStatus,
  useDoor,
  useSendWhenReady,
} from '@/features/door/useDoor.tsx';
import { FilePicker, useFilingTarget } from '@/features/files/FilesCard.tsx';
import { useUploader } from '@/features/files/uploader.ts';
import { ApiRequestError, call } from '@/lib/api.ts';
import { Btn } from '@/mockup/Btn.tsx';
import { Choice, Choices } from '@/mockup/Choice.tsx';
import { CheckBox, Field } from '@/mockup/Field.tsx';
import { PausedForm, useIntakePaused } from '../flood/IntakePaused.tsx';
import { CardBar, CardError, CardFrame, FilingProgress, useCardTitle } from './CardFrame.tsx';
import { useCardHistory } from './cardHistory.ts';
import type { CardEntry } from './cardHistory.ts';
import { FormColumn, FormNotice } from './FormNotice.tsx';
import { Cover } from './Cover.tsx';
import { ContactCard, ManageCard, ShareCard, shortened } from './WrittenCards.tsx';
import type { CtaProps } from './HelpNow.tsx';
import { QuestionControl, isTiles, kindHelp } from './QuestionControl.tsx';
import { rememberForTip } from './tipOffer.tsx';
import { FiledReceipt, LimitPage, SentReceipt } from './Receipts.tsx';
import {
  askedCards,
  askedQuestions,
  cardProblem,
  everyCardId,
  isHeldKind,
  sealedAnswers,
  shownAnswer,
  stillPossible,
  toSubmission,
  wroteSomething,
  withChange,
} from './walk.ts';
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

type Step =
  'intro' | 'publish' | 'share' | 'contact' | 'manage' | 'files' | 'review' | `q:${string}`;

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
          <Note tone="serious" title="The form did not load">
            {logbook.error.message}
          </Note>
        )}
      </FormNotice>
    );
  }
  const lb = logbook.data;
  if (!lb.accepting) {
    return (
      <FormNotice title={lb.title}>
        <Panel kind="quiet">
          <p className="max-w-prose">
            {lb.state !== 'scheduled'
              ? 'This logbook is closed. It is not taking reports.'
              : lb.opens_at
                ? `This logbook has not opened yet. It opens on ${new Date(lb.opens_at).toLocaleString()}.`
                : 'This logbook has not opened yet.'}
          </p>
        </Panel>
      </FormNotice>
    );
  }
  // Plan E: a moderator paused intake (features/flood).
  if (paused) return <PausedForm title={lb.title} />;
  if (intake.data?.open === false) {
    return (
      <FormNotice title={lb.title}>
        <Panel kind="quiet">
          <p className="max-w-prose">
            This site is not taking reports at the moment. Nothing you type here could be sent.
            Please come back later.
          </p>
        </Panel>
      </FormNotice>
    );
  }
  return (
    <Cards
      slug={lb.slug}
      title={lb.title}
      blurb={lb.blurb}
      cover={lb.cover}
      siteCta={{
        text: lb.site_cta?.body ?? lb.help_now,
        heading: lb.site_cta?.heading,
        buttonLabel: lb.site_cta?.button_label,
        buttonUrl: lb.site_cta?.button_url,
      }}
      questions={lb.fields}
      form={lb.form}
      asksEmail={lb.asks_email}
      emailOptional={lb.email_optional === true}
      deleteOn={lb.contacts_delete_on}
      terms={lb.publication_terms}
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
  cover,
  siteCta,
  questions,
  form,
  asksEmail,
  emailOptional,
  deleteOn,
  terms,
  card,
  cardError,
  retryCard,
  history,
}: {
  slug: string;
  title: string;
  blurb: string | null;
  /** The cover page's words (decision 78). Never sealed. */
  cover: CoverWords | undefined;
  /** The site's call to action, sent with the form so a door has it. */
  siteCta: CtaProps;
  questions: FormQuestion[];
  /** Whether this logbook asks for an address at all (E1). */
  asksEmail: boolean;
  /** The operator's optional card is on: an address may be given or skipped (D8, D20). */
  emailOptional: boolean;
  /** The day addresses are deleted, YYYY-MM-DD, where one can be given (D4). */
  deleteOn: string | undefined;
  /** The version these questions are; sealed if only wording changes before Send. */
  form?: string | undefined;
  /**
   * Where publication is a condition of filing: shown on the last card in
   * place of the question, and their digest is what is sealed.
   */
  terms?: { heading: string; body: string[]; digest: string } | undefined;
  card: PublicationCard | undefined;
  cardError: boolean;
  retryCard: () => void;
  history: RouterHistory | undefined;
}) {
  const [raw, setRaw] = useState<RawAnswers>({});
  const [publish, setPublish] = useState('');
  const [email, setEmail] = useState('');
  // Whether journalists may read what was written: '' until the reporter chooses.
  const [share, setShare] = useState<'' | 'yes' | 'no'>('');
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
  // D8. What the reporter wrote or pasted decides whether an address is
  // needed; going back to clear it makes the card optional again.
  const hasHeldQuestion = questions.some((q) => isHeldKind(q.kind));
  const wrote = wroteSomething(questions, raw);
  const needsAddress = asksEmail || wrote;
  const manageCard = !needsAddress && emailOptional;
  const givesAddress = needsAddress || (manageCard && email.trim() !== '');
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
          ...(givesAddress ? { email: email.trim() } : {}),
          ...door.fields(),
          consent,
          answers: toSubmission(questions, raw),
          // Not answering is "no", and the card said so before anybody acted.
          // Under terms nobody was asked: filing is the agreement.
          ...(wrote ? { journalist_sharing: share === 'yes' } : {}),
          may_publish: terms ? true : publish === 'yes',
          may_publish_digest: terms ? terms.digest : (card?.digest ?? ''),
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
  // The cards from the opening one to the review, for these answers. Worked
  // out for any set of answers so Skip, which clears one, can ask what comes
  // next without waiting for the page to draw again.
  const stepsFor = (r: RawAnswers): Step[] => {
    const w = wroteSomething(questions, r);
    return [
      'intro',
      ...askedCards(questions, r).map((c): Step => `q:${c.id}`),
      ...(terms ? [] : (['publish'] as Step[])),
      ...(w ? (['share'] as Step[]) : []),
      ...(asksEmail || w ? (['contact'] as Step[]) : emailOptional ? (['manage'] as Step[]) : []),
      ...(takesFiles ? (['files'] as Step[]) : []),
      'review',
    ];
  };
  const steps = stepsFor(raw);
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
    'share',
    'contact',
    'manage',
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
    (mayTakeFiles ? 4 : 3) +
    // The sharing card could still come, if anything is written (it is
    // counted from the start so the rule never moves back).
    (hasHeldQuestion ? 1 : 0) -
    (asksEmail || hasHeldQuestion || emailOptional ? 0 : 1) -
    (terms ? 1 : 0);
  const progress = send.isSuccess || step === 'intro' ? null : Math.min(1, at / possible);

  // The tab title (filing.md §02): the question, where it is among the cards
  // still possible (the opening card not counted), and the site.
  const tabHeading: Record<string, string> = {
    intro: title,
    review: 'Check your answers',
    publish: card?.question ?? 'Should this report be published?',
    share: 'Can vetted journalists read what you wrote?',
    manage: 'Want to be able to correct it later?',
    contact: wrote ? 'Your email address' : 'Where can we reach you?',
    files: fileQuestion?.label ?? 'Files',
  };
  useCardTitle(
    send.isSuccess ? 'Your report was sent' : (tabHeading[step] ?? shownHeading),
    send.isSuccess || step === 'intro' || step === 'review' ? null : { n: at, of: possible - 1 },
  );

  if (send.isSuccess) {
    return 'filed' in send.data ? (
      <FiledReceipt title={title} reference={send.data.public_ref} />
    ) : (
      <SentReceipt
        email={email.trim()}
        title={title}
        onChangeAddress={() => {
          send.reset();
          setStep('contact');
          cards.push({ card: 'contact', toReview: false });
        }}
      />
    );
  }

  // D5: the sixth report from one address in a day. Said as the mock-up says
  // it, and the answers are still here behind it.
  if (send.isError && send.error instanceof ApiRequestError && send.error.code === 'try_later') {
    return (
      <LimitPage
        onBack={() => {
          send.reset();
        }}
      />
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
    if (step === 'share' && share === '') return 'Choose yes or no.';
    if (step === 'contact' && !looksLikeEmail(email))
      return 'Enter an email address we can reach you at.';
    if (step === 'manage' && email.trim() !== '' && !looksLikeEmail(email))
      return 'That does not look like an email address. Check it, or clear the box to skip this.';
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
    const now = stepsFor(raw);
    go(now[now.indexOf(step) + 1] ?? 'review');
  };
  // Where the browser's Back would go: after "Change", that is the review.
  // On the first question it is the opening card.
  // "Skip this" on a card for words or a link: the box is cleared, never left
  // half-typed behind a skip, and the next card is worked out without it.
  const skip = (key: string) => {
    const cleared = withChange(questions, raw, key, undefined);
    setRaw(cleared);
    setProblem(null);
    if (backToReview) {
      go('review');
      return;
    }
    const now = stepsFor(cleared);
    go(now[now.indexOf(step) + 1] ?? 'review');
  };
  const back = () => {
    if (cards.back) cards.back();
    else go(steps[at - 1] ?? 'intro');
  };
  const sendNow = () => {
    if (!consent) {
      setProblem('Tick the statement above to send the report.');
      return;
    }
    if (wrote && share === '') {
      setProblem('Choose whether journalists may read what you wrote. Press Change beside it.');
      return;
    }
    if (needsAddress && !looksLikeEmail(email)) {
      setProblem('Enter an email address we can reach you at. Press Change beside it.');
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

  // The cards share the mock-up's `.qcard` form: the progress bar at the top,
  // the card, then the bar with Back and Next. Enter in a box presses Next,
  // as the button does; choosing an answer never does.
  const cardBar =
    step === 'intro' ? null : (
      <CardBar
        submit
        go={step === 'review'}
        onBack={back}
        primary={step === 'review' ? 'Send' : 'Next'}
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
    );

  return (
    <FormColumn>
      <Honeypot door={door} />
      <DoorPuzzle door={door} />

      {step === 'intro' ? (
        <>
          <FilingProgress value={progress} question={null} />
          <Cover
            kind="logbook"
            title={title}
            blurb={blurb}
            cover={cover}
            site={siteCta}
            onStart={next}
          />
        </>
      ) : (
        <form
          noValidate
          className="qcard"
          onSubmit={(e) => {
            e.preventDefault();
            if (step === 'review') sendNow();
            else next();
          }}
        >
          <FilingProgress value={progress} question={step === 'review' ? null : at} />

          {shownCard ? (
            <QuestionCard
              key={shownCard.id}
              eyebrow={title}
              parts={shownCard.parts}
              heading={shownHeading}
              help={helpFor(
                questions.find((q) => q.key === shownCard.id) ??
                  shownCard.parts[0] ?? { help: null },
                sealed,
              )}
              raw={raw}
              answers={sealed}
              onChange={(key, v) => {
                setProblem(null);
                setRaw((r) => withChange(questions, r, key, v));
              }}
              problem={problem}
              onSkip={skip}
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

          {step === 'share' ? (
            <ShareCard
              eyebrow={title}
              value={share}
              onChange={(v) => {
                setProblem(null);
                setShare(v);
              }}
              problem={problem}
            />
          ) : null}

          {step === 'contact' ? (
            <ContactCard
              eyebrow={title}
              wrote={wrote}
              deleteOn={deleteOn}
              value={email}
              onChange={(v) => {
                setProblem(null);
                setEmail(v);
              }}
              problem={problem}
            />
          ) : null}

          {step === 'manage' ? (
            <ManageCard
              eyebrow={title}
              deleteOn={deleteOn}
              value={email}
              onChange={(v) => {
                setProblem(null);
                setEmail(v);
              }}
              problem={problem}
            />
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
                  <p className="muted whitespace-pre-wrap">{fileQuestion.help}</p>
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
            <CardFrame
              eyebrow={title}
              stepLabel="Review"
              heading="Check your answers"
              headingId="review-heading"
              focusKey={step}
            >
              <p className="muted">
                {givesAddress
                  ? 'Nothing is filed until you confirm it from your email. Check it over first.'
                  : 'Your report is filed the moment you send it, and you cannot come back to it. Check it over first.'}
              </p>
              <div className="review">
                {asked.map((q) => (
                  <ReviewRow
                    key={q.key}
                    label={isHeldKind(q.kind) ? `${q.label} · not published` : q.label}
                    value={shortened(shownAnswer(q, raw, questions), q.kind)}
                    required={q.required}
                    onChange={() => {
                      go(`q:${cardOf.get(q.key) ?? q.key}`, true);
                    }}
                  />
                ))}
                {terms ? null : (
                  <ReviewRow
                    label="Published if approved"
                    value={
                      publish === 'yes' ? (card?.options.yes ?? 'Yes') : (card?.options.no ?? 'No')
                    }
                    required
                    onChange={() => {
                      go('publish', true);
                    }}
                  />
                )}
                {takesFiles && fileQuestion ? (
                  <ReviewRow
                    label={fileQuestion.label}
                    value={
                      uploader.kept.length ? uploader.kept.map((f) => f.name).join(', ') : null
                    }
                    required={fileQuestion.required}
                    onChange={() => {
                      go('files', true);
                    }}
                  />
                ) : null}
                {wrote ? (
                  <ReviewRow
                    label="Vetted journalists"
                    value={
                      share === 'yes'
                        ? 'May read it after a moderator checks it'
                        : share === 'no'
                          ? 'Moderators only'
                          : null
                    }
                    required
                    onChange={() => {
                      go('share', true);
                    }}
                  />
                ) : null}
                {needsAddress ? (
                  <ReviewRow
                    label={wrote ? 'Email' : 'Your email address'}
                    value={email.trim() || null}
                    required
                    onChange={() => {
                      go('contact', true);
                    }}
                  />
                ) : manageCard ? (
                  <ReviewRow
                    label="Manage link sent to"
                    value={email.trim() || 'Nobody (skipped)'}
                    required={false}
                    onChange={() => {
                      go('manage', true);
                    }}
                  />
                ) : null}
              </div>
              {wrote ? (
                <div className="cta">
                  <span className="mark">What is published</span>
                  <p>
                    After a moderator approves it, your answers are published on the board. What you
                    wrote and any links are never published, and you can erase them at any time from
                    My reports. Your answers stay in the sealed record.
                  </p>
                </div>
              ) : null}
              {terms ? (
                <div className="cta">
                  <span className="mark">{terms.heading}</span>
                  {terms.body.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              ) : null}
              <CheckBox
                id="filing-statement"
                checked={consent}
                onChange={(e) => {
                  setProblem(null);
                  setConsent(e.target.checked);
                }}
              >
                {STATEMENT}
              </CheckBox>
              {/* The operator's own line about sending, when they wrote one. */}
              <CopyText slot="send_note" className="lbl" />
              {/* G7, D2: said only when no address was given. With one, the
                  report can be corrected or taken off the board from My reports, and says so.
                  Never "withdrawn": the report is sealed and cannot be deleted (terms § 4). */}
              {givesAddress ? (
                <Note>
                  <b>
                    From My reports you can add a correction or take this report off the public
                    board. The report itself is sealed and can’t be deleted.
                  </b>
                </Note>
              ) : (
                <Note warn>
                  <b>This report can’t be changed or taken down after you send it.</b>
                </Note>
              )}
            </CardFrame>
          ) : null}

          {cardBar}
        </form>
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
      {problem ? (
        <CardError key={problem} focus>
          {problem}
        </CardError>
      ) : null}
      {failure ? (
        <CardError key={failure} focus>
          <b>The report was not sent.</b> {failure}
        </CardError>
      ) : null}
      {status ? (
        <p role="status" className="muted">
          {status}
        </p>
      ) : null}
    </>
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
  onSkip,
}: {
  eyebrow: string;
  parts: FormQuestion[];
  heading: string;
  help: string | undefined;
  raw: RawAnswers;
  answers: Record<string, unknown>;
  onChange: (key: string, v: RawValue | undefined) => void;
  problem: string | null;
  /** Skip a card of words or a link: clears it and goes on. */
  onSkip: (key: string) => void;
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
  const held = Boolean(single && isHeldKind(single.kind));
  // A question an earlier answer turned on says so, as the mock-up's step does.
  const turnedOn = parts[0]?.shown_when ? 'asked because of an earlier answer' : undefined;
  const grouped = Boolean(single && isTiles(single, sealedSoFar));
  return (
    <CardFrame
      eyebrow={eyebrow}
      heading={heading}
      focusKey={parts[0]?.key ?? ''}
      headingId={headingId}
      optional={Boolean(single && !held && !single.required)}
      step={held && single && !single.required ? 'Optional' : undefined}
      note={turnedOn}
      grouped={grouped}
      help={
        help || extra ? (
          <div id={helpId} style={{ display: 'grid', gap: 4 }}>
            {help ? <p className="muted whitespace-pre-wrap">{help}</p> : null}
            {extra ? <p className="muted">{extra}</p> : null}
          </div>
        ) : null
      }
      error={problem}
      errorId={errorId}
    >
      {single ? (
        <>
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
            grouped={grouped}
          />
          {held && !single.required ? (
            <a
              className="skip-link"
              href="#skip"
              role="button"
              onClick={(e) => {
                e.preventDefault();
                onSkip(single.key);
              }}
            >
              Skip this
            </a>
          ) : null}
        </>
      ) : (
        <div role="group" aria-labelledby={headingId} style={{ display: 'grid', gap: 16 }}>
          {parts.map((part, i) => {
            const partId = `${id}-part-${String(i)}`;
            // A tick box carries its own label beside the box.
            const box = part.kind === 'yes_no' && part.settings.checkbox === true;
            const tiles = isTiles(part, sealedSoFar);
            const partHelp = [i === 0 ? undefined : part.help, kindHelp(part, part.label)]
              .filter(Boolean)
              .join(' ');
            return (
              <Field
                key={part.key}
                {...(box
                  ? {}
                  : {
                      label: (
                        <>
                          {part.label}
                          {part.required ? null : (
                            <>
                              {' '}
                              <span className="muted">(optional)</span>
                            </>
                          )}
                        </>
                      ),
                    })}
                {...(tiles ? { labelId: partId } : { htmlFor: partId, labelId: `${partId}-label` })}
                help={partHelp || undefined}
                helpId={`${partId}-help`}
              >
                <QuestionControl
                  question={part}
                  id={partId}
                  value={raw[part.key]}
                  onChange={(v) => {
                    onChange(part.key, v);
                  }}
                  // A control is named by its own label, never by itself: a
                  // select named by itself reads out every option.
                  labelledBy={box ? headingId : tiles ? partId : `${partId}-label`}
                  describedBy={
                    [partHelp ? `${partId}-help` : '', problem ? errorId : '']
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  invalid={Boolean(problem)}
                  answers={sealedSoFar}
                  raw={raw}
                />
              </Field>
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
          <Note warn role="alert">
            <b>The wording of this question did not load.</b> The report cannot be sent without it.{' '}
            <Btn sm flat onClick={onRetry}>
              Try again
            </Btn>
          </Note>
        ) : (
          <p role="status" className="muted">
            Loading the wording…
          </p>
        )}
      </CardFrame>
    );
  }
  // NOTHING IS SELECTED until the reporter chooses: both tiles stay unchecked
  // while `value` is '' and the card says what not answering means.
  return (
    <CardFrame
      eyebrow={eyebrow}
      heading={card.question}
      focusKey="publish"
      headingId={`${id}-q`}
      help={
        <>
          {card.body.map((line) => (
            <p key={line} className="muted">
              {line}
            </p>
          ))}
          <p className="muted">
            <b>{card.optionality}</b>
          </p>
        </>
      }
      error={problem}
    >
      <Choices role="radiogroup" aria-labelledby={`${id}-q`}>
        <Choice
          name={`${id}-publish`}
          checked={value === 'yes'}
          onChange={() => {
            onChange('yes');
          }}
        >
          {card.options.yes}
        </Choice>
        <Choice
          name={`${id}-publish`}
          checked={value === 'no'}
          onChange={() => {
            onChange('no');
          }}
        >
          {card.options.no}
        </Choice>
      </Choices>
    </CardFrame>
  );
}

/** One line of the mock-up's review (site.css `.review`): the question, the answer, Change. */
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
  return (
    <div>
      <span className="q">{label}</span>
      <span className="a" style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
        {value ??
          // The cards do not let this happen; said plainly if it ever does.
          (required ? (
            <span style={{ color: 'var(--rl-serious)' }}>Not answered</span>
          ) : (
            <span className="muted">Not answered</span>
          ))}
      </span>
      <Btn sm flat onClick={onChange} aria-label={`Change: ${label}`}>
        Change
      </Btn>
    </div>
  );
}
