import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Btn } from './Btn.tsx';

/** The mock-up's `file-drop`: a dashed area with a button, which also takes a dropped file. */
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
  disabled?: boolean | undefined;
  buttonLabel?: ReactNode | undefined;
  labelledBy?: string | undefined;
  limits?: ReactNode | undefined;
  describedBy?: string | undefined;
  className?: string | undefined;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const limitsId = `${id}-limits`;
  const described = limits ? limitsId : describedBy;
  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  return (
    // Dropping is an extra for a mouse; the button is the way in for everybody.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="file-drop"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (!disabled) take(e.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        type="file"
        className="vh"
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
      <Btn sm flat
        
        disabled={disabled}
        aria-describedby={described}
        onClick={() => input.current?.click()}
      >
        {buttonLabel}
      </Btn>
      {limits ? (
        <p id={limitsId} className="muted">
          {limits}
        </p>
      ) : null}
    </div>
  );
}
