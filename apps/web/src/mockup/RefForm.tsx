import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

/**
 * The mock-up's reference field (verify.html): a label, the input and its
 * button in one bordered row (`.search`), and a line of help. Enter goes to
 * `/verify/:ref`. It asks the server for nothing.
 */
export function RefForm({
  initial = '',
  help = 'Looks like RL-XXXX-XX. It is on the report page and in your email.',
}: {
  /** The reference to start with (the page that is showing its check). */
  initial?: string;
  help?: string;
}) {
  const navigate = useNavigate();
  const [ref, setRef] = useState(initial);
  return (
    <form
      className="form-stack"
      role="search"
      aria-label="Check a report"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = ref.trim();
        if (trimmed) void navigate({ to: '/verify/$ref', params: { ref: trimmed } });
      }}
    >
      <div className="field">
        <label htmlFor="ref">Reference</label>
        <div className="search" style={{ paddingRight: 6 }}>
          <input
            id="ref"
            type="text"
            value={ref}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters"
            aria-describedby="ref-help"
            style={{ fontFamily: 'var(--rl-font-mono)' }}
            onChange={(e) => {
              setRef(e.target.value);
            }}
          />
          <button className="btn sm flat go" type="submit">
            Check
          </button>
        </div>
        <span className="help" id="ref-help">
          {help}
        </span>
      </div>
    </form>
  );
}
