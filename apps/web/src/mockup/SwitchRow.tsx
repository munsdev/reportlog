import type { ReactNode } from 'react';

/**
 * The mock-up's `switch`: a name and a line of what it does at the left, the
 * `tgl` at the right. It applies the moment it is pressed, so a screen that
 * needs a question first asks it before calling `onChange`.
 */
export function Switch({
  label,
  help,
  checked,
  busy = false,
  disabled = false,
  onChange,
}: {
  label: ReactNode;
  help?: ReactNode;
  checked: boolean;
  busy?: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const name = typeof label === 'string' ? label : undefined;
  return (
    <div className="switch">
      <div>
        <b>{label}</b>
        <span>{help}</span>
      </div>
      <button
        type="button"
        className="tgl"
        role="switch"
        aria-checked={checked}
        aria-busy={busy || undefined}
        aria-label={name}
        disabled={disabled || busy}
        onClick={() => {
          onChange(!checked);
        }}
      />
    </div>
  );
}
