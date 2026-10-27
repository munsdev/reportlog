/**
 * The two kinds of answer kept apart from the report (W1): the reporter's own
 * words, and links. Each is optional on its card, says before anything is
 * typed that it is never published, and can be skipped.
 *
 * Nothing here changes under the reader: "Add another link" adds a box the
 * reporter asked for, and that is all.
 */
import type { FormQuestion } from '@reportlog/contracts';
import { maxLinksOf } from '@reportlog/fields';
import { useId } from 'react';

import { Btn } from '@/mockup/Btn.tsx';
import { Field, TextArea, TextInput } from '@/mockup/Field.tsx';
import { Note } from '@/mockup/Note.tsx';
import type { RawValue } from './walk.ts';

/** The words under both controls. Plain: what it is, who may read it, that it can go. */
export const NOT_PUBLISHED = {
  lead: 'Not published on the board.',
  rest: 'Only vetted journalists may read it, only if you allow it, and only after a moderator has checked it. You can erase it later.',
};

export function NotPublished() {
  return (
    <Note lock>
      <b>{NOT_PUBLISHED.lead}</b> {NOT_PUBLISHED.rest}
    </Note>
  );
}

interface HeldProps {
  question: FormQuestion;
  value: RawValue | undefined;
  onChange: (value: RawValue | undefined) => void;
  labelledBy: string;
  describedBy?: string | undefined;
  invalid: boolean;
  id?: string | undefined;
}

export const TEXT_MAX = 5000;

/** The mock-up's "(optional)" after a label. */
const Optional = () => <span className="muted">(optional)</span>;

export function PrivateTextControl({
  question: q,
  value,
  onChange,
  describedBy,
  invalid,
  id,
}: HeldProps) {
  const own = useId();
  const boxId = id ?? own;
  const text = typeof value === 'string' ? value : '';
  const max = typeof q.settings.maxLength === 'number' ? q.settings.maxLength : TEXT_MAX;
  return (
    <>
      <Field
        label={<>What happened {q.required ? null : <Optional />}</>}
        htmlFor={boxId}
        // Always shown: unlike a short box, it is the reader's place to see how much room is left.
        help={
          <span aria-live="polite">
            {text.length} / {max}
          </span>
        }
        helpMono
      >
        <TextArea
          id={boxId}
          value={text}
          rows={7}
          maxLength={max}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      </Field>
      <NotPublished />
    </>
  );
}

export function PrivateLinksControl({
  question: q,
  value,
  onChange,
  describedBy,
  invalid,
  id,
}: HeldProps) {
  const own = useId();
  const boxId = id ?? own;
  const max = maxLinksOf(q.settings);
  const boxes = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  // One box to start with; a box is added only when the reporter asks.
  const shown = boxes.length ? boxes : [''];
  const set = (i: number, v: string) => {
    const next = [...shown];
    next[i] = v;
    onChange(next);
  };
  return (
    <>
      {shown.map((link, i) => (
        // The position IS the identity of a box the reporter is typing in.
        <Field
          key={i}
          label={
            <>
              {i === 0 ? 'Link' : `Link ${String(i + 1)}`}{' '}
              {i === 0 && !q.required ? <Optional /> : null}
            </>
          }
          htmlFor={`${boxId}-${String(i)}`}
        >
          <TextInput
            id={`${boxId}-${String(i)}`}
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://"
            value={link}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onChange={(e) => {
              set(i, e.target.value);
            }}
          />
        </Field>
      ))}
      {shown.length < max ? (
        <Btn
          sm
          flat
          look="ghost"
          style={{ justifySelf: 'start' }}
          onClick={() => {
            onChange([...shown, '']);
          }}
        >
          Add another link
        </Btn>
      ) : null}
      <NotPublished />
    </>
  );
}
