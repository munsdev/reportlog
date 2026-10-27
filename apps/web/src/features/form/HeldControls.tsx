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

import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import type { RawValue } from './walk.ts';

/** The words under both controls. Plain: what it is, who may read it, that it can go. */
export const NOT_PUBLISHED = {
  lead: 'Not published on the board.',
  rest: 'Only vetted journalists may read it, only if you allow it, and only after a moderator has checked it. You can erase it later.',
};

export function NotPublished() {
  return (
    <Alert tone="note">
      <span>
        <b>{NOT_PUBLISHED.lead}</b> {NOT_PUBLISHED.rest}
      </span>
    </Alert>
  );
}

interface HeldProps {
  question: FormQuestion;
  value: RawValue | undefined;
  onChange: (value: RawValue | undefined) => void;
  labelledBy: string;
  describedBy?: string | undefined;
  invalid: boolean;
}

export const TEXT_MAX = 5000;

export function PrivateTextControl({
  question: q,
  value,
  onChange,
  labelledBy,
  describedBy,
  invalid,
}: HeldProps) {
  const text = typeof value === 'string' ? value : '';
  const max = typeof q.settings.maxLength === 'number' ? q.settings.maxLength : TEXT_MAX;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Textarea
          value={text}
          rows={7}
          maxLength={max}
          className="min-h-40"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
        {/* Always shown: unlike a short box, it is the reader's place to see how much room is left. */}
        <p aria-live="polite" className="font-mono text-[0.8125rem] text-muted">
          {text.length} / {max}
        </p>
      </div>
      <NotPublished />
    </div>
  );
}

export function PrivateLinksControl({
  question: q,
  value,
  onChange,
  labelledBy,
  describedBy,
  invalid,
}: HeldProps) {
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
    <div className="flex flex-col gap-4">
      <div role="group" aria-labelledby={labelledBy} className="flex flex-col gap-3">
        {shown.map((link, i) => (
          <Input
            // The position IS the identity of a box the reporter is typing in.
            key={i}
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://"
            value={link}
            aria-label={max > 1 ? `Link ${String(i + 1)}` : 'Link'}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onChange={(e) => {
              set(i, e.target.value);
            }}
          />
        ))}
      </div>
      {shown.length < max ? (
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          onClick={() => {
            onChange([...shown, '']);
          }}
        >
          Add another link
        </Button>
      ) : null}
      <NotPublished />
    </div>
  );
}
