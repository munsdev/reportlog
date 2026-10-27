/**
 * A staff action that needs words from the moderator: a reason, alt text,
 * a message to the reporter.
 *
 * ONE CARD ASKS ONE QUESTION. An action needing two answers (publishing
 * needs alt text and a reason) asks them one after the other, and moving on
 * is always the moderator's own press: nothing advances by itself, and
 * nothing already typed changes underneath them. The last card's button
 * names exactly what it does. With no questions it is a plain "are you
 * sure", for an act worth a second press.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Btn } from '../../../mockup/Btn.tsx';
import {
  Field,
  FieldDescription,
  FieldError,
  Input,
  Label,
  Textarea,
} from '../../../mockup/Form.tsx';
import { Modal } from '../../../mockup/Modal.tsx';
import { Problem } from '../../../mockup/Notice.tsx';

export interface Question {
  label: string;
  hint?: ReactNode;
  multiline?: boolean;
  /** Fewest characters that count as an answer. */
  min?: number;
  max?: number;
  /** Shown when the answer is shorter than `min`. */
  tooShort?: string;
}

export function AskDialog({
  trigger,
  title,
  description,
  questions,
  finish,
  onFinish,
  after,
}: {
  /** Draws the button that opens it; `open` is what its click calls. */
  trigger: (open: () => void) => ReactNode;
  title: string;
  description?: ReactNode;
  questions: readonly Question[];
  /** The last button's words: what pressing it does. */
  finish: string;
  /** Throws an error whose message is a sentence to show. */
  onFinish: (answers: string[]) => Promise<unknown>;
  /** Shown instead of the questions once it is done; without it, the dialog closes. */
  after?: (answers: string[]) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => {
    setStep(0);
    setAnswers(questions.map(() => ''));
    setTried(false);
    setBusy(false);
    setFailed(null);
    setDone(false);
  };
  const q = questions[step];
  const value = answers[step] ?? '';
  const problem =
    q && value.trim().length < (q.min ?? 1)
      ? (q.tooShort ?? 'Write a few words here first.')
      : null;
  const last = step >= questions.length - 1;

  const next = async () => {
    setTried(true);
    if (problem) return;
    setTried(false);
    if (!last) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    setFailed(null);
    try {
      await onFinish(answers.map((a) => a.trim()));
      if (after) setDone(true);
      else {
        setOpen(false);
        reset();
      }
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const answerStep = (
    <>
      {questions.length > 1 ? (
        <span className="step">
          Question {String(step + 1)} of {String(questions.length)}
        </span>
      ) : null}
      {q ? (
        <Field key={step}>
          <Label>{q.label}</Label>
          {q.hint ? <FieldDescription>{q.hint}</FieldDescription> : null}
          {q.multiline ? (
            <Textarea
              rows={4}
              value={value}
              maxLength={q.max}
              onChange={(e) => {
                const v = e.target.value;
                setAnswers((a) => a.map((x, i) => (i === step ? v : x)));
              }}
            />
          ) : (
            <Input
              value={value}
              maxLength={q.max}
              autoComplete="off"
              onChange={(e) => {
                const v = e.target.value;
                setAnswers((a) => a.map((x, i) => (i === step ? v : x)));
              }}
            />
          )}
          <FieldError>{tried ? problem : null}</FieldError>
        </Field>
      ) : null}
      {failed ? <Problem>{failed}</Problem> : null}
    </>
  );
  const close = () => {
    setOpen(false);
    reset();
  };
  const showingDone = done && after;
  return (
    <>
      {trigger(() => {
        setOpen(true);
      })}
      <Modal
        title={title}
        description={description}
        open={open}
        onClose={close}
        {...(showingDone
          ? {}
          : {
              onSubmit: () => {
                void next();
              },
            })}
        buttons={
          showingDone ? (
            <Btn sm flat className="ghost" onClick={close}>
              Close
            </Btn>
          ) : (
            <>
              <Btn sm flat look="ink" type="submit" disabled={busy}>
                {last ? finish : 'Next'}
              </Btn>
              {step > 0 ? (
                <Btn
                  sm
                  flat
                  onClick={() => {
                    setTried(false);
                    setStep(step - 1);
                  }}
                >
                  Back
                </Btn>
              ) : null}
              <Btn sm flat look="ghost" onClick={close}>
                Cancel
              </Btn>
            </>
          )
        }
      >
        {showingDone ? after(answers.map((a) => a.trim())) : answerStep}
      </Modal>
    </>
  );
}
