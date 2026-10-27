import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * The mock-up's `file-drop`: a dashed label ("Choose files", the limits under
 * it) over the browser's own file input, which is kept (it opens the phone's
 * camera roll and the desktop's file dialog) but never shown. A desktop also
 * takes files dropped onto it, as an extra and never the only way. What
 * happens to the files is the caller's; the limits are one sentence the input
 * is described by.
 */
export function FileDrop({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  buttonLabel = multiple ? 'Choose files' : 'Choose a file',
  labelledBy,
  limits,
  describedBy,
}: {
  onFiles: (files: File[]) => void;
  accept?: string | undefined;
  multiple?: boolean | undefined;
  /** Off when no more files fit; the limits sentence says why. */
  disabled?: boolean | undefined;
  buttonLabel?: ReactNode | undefined;
  /** The id of whatever names this question, for the input's name. */
  labelledBy?: string | undefined;
  limits?: ReactNode | undefined;
  /** Or the id of a limits sentence the screen already shows elsewhere. */
  describedBy?: string | undefined;
  className?: string | undefined;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const limitsId = `${id}-limits`;
  const described = limits ? limitsId : describedBy;
  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  return (
    <>
      <label
        className="file-drop"
        htmlFor={id}
        style={{
          ...(over && !disabled ? { borderColor: 'var(--rl-border-main)' } : {}),
          ...(disabled ? { opacity: 0.55, cursor: 'not-allowed' } : {}),
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => {
          setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) take(e.dataTransfer.files);
        }}
      >
        <b>{buttonLabel}</b>
        {limits ? <span id={limitsId}>{limits}</span> : null}
      </label>
      <input
        ref={input}
        id={id}
        type="file"
        className="vh"
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
    </>
  );
}
