/**
 * Choosing files: a "Choose files" button over the browser's own file input,
 * which is kept (it is what opens the phone's camera roll and the desktop's
 * file dialog) but never shown. On a desktop the area also takes files
 * dropped onto it, as an extra and never the only way.
 *
 * What happens to the files is the caller's: each screen checks them against
 * its own limits and shows its own list. The limits are said in one sentence
 * the caller passes as `limits`, which the input is described by.
 */
import { useId, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';
import { Button } from './button.tsx';

export interface FileDropProps {
  onFiles: (files: File[]) => void;
  accept?: string | undefined;
  multiple?: boolean | undefined;
  /** Off when no more files fit; the limits sentence says why. */
  disabled?: boolean | undefined;
  /** The words on the button: "Choose files", "Add another file". */
  buttonLabel?: ReactNode | undefined;
  /** The id of whatever names this question, for the input's name. */
  labelledBy?: string | undefined;
  /** The limits, in one sentence: "Up to 5 files, together less than 50 MB." */
  limits?: ReactNode | undefined;
  /** Or the id of a limits sentence the screen already shows elsewhere. */
  describedBy?: string | undefined;
  className?: string | undefined;
}

export function FileDrop({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  buttonLabel = multiple ? 'Choose files' : 'Choose a file',
  labelledBy,
  limits,
  describedBy,
  className,
}: FileDropProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const limitsId = `${id}-limits`;
  const described = limits ? limitsId : describedBy;

  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) take(e.dataTransfer.files);
  };

  return (
    // Dropping is an extra for a mouse; the button is the way in for
    // everybody, so the area itself needs no keyboard handling.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className={cn(
        'flex flex-col items-start gap-2 rounded-card',
        over && !disabled && 'outline-2 outline-offset-4 outline-dashed outline-ink',
        className,
      )}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={onDrop}
    >
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        multiple={multiple}
        accept={accept}
        disabled={disabled}
        aria-labelledby={labelledBy}
        aria-describedby={described}
        onChange={(e) => {
          take(e.target.files);
          // So choosing the same file again, after removing it, still counts.
          e.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        aria-describedby={described}
        onClick={() => input.current?.click()}
      >
        {buttonLabel}
      </Button>
      {limits ? (
        <p id={limitsId} className="text-sm text-ink-alt">
          {limits}
        </p>
      ) : null}
    </div>
  );
}
