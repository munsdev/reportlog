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
import { Alert } from '../../../components/ui/alert.tsx';
import { Button } from '../../../components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../../components/ui/dialog.tsx';
import { Field, FieldDescription, FieldError } from '../../../components/ui/field.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { Label } from '../../../components/ui/label.tsx';
import { Textarea } from '../../../components/ui/textarea.tsx';

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
  trigger: ReactNode;
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

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {done && after ? (
          after(answers.map((a) => a.trim()))
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void next();
            }}
          >
            {questions.length > 1 ? (
              <p className="text-sm text-ink-alt">
                Question {String(step + 1)} of {String(questions.length)}
              </p>
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
            {failed ? <Alert tone="serious">{failed}</Alert> : null}
            <DialogFooter>
              {step > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setTried(false);
                    setStep(step - 1);
                  }}
                >
                  Back
                </Button>
              ) : null}
              <Button type="submit" disabled={busy}>
                {last ? finish : 'Next'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
