import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Btn } from '@/mockup/Btn.tsx';
import { Field, FieldDescription, Input, Label } from '@/mockup/Field.tsx';

/**
 * A reference, checked. Shared by the front page, /verify, a verify page's
 * "Check another" and the page for a wrong address. Enter goes.
 */
export function CheckAReport({
  label = 'Report reference',
  button = 'Check it',
  help = null,
  initial = '',
  inline = false,
}: {
  label?: string;
  button?: string;
  help?: string | null;
  /** The reference to start with (the page that is showing its check). */
  initial?: string;
  /** The mock-up's field: the input and its button in one bordered row. */
  inline?: boolean;
}) {
  const navigate = useNavigate();
  const [ref, setRef] = useState(initial);
  return (
    <form
      role="search"
      aria-label="Check a report"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = ref.trim();
        if (trimmed) void navigate({ to: '/verify/$ref', params: { ref: trimmed } });
      }}
      style={{ display: 'grid', gap: 12 }}
    >
      <Field>
        <Label>{label}</Label>
        {help ? <FieldDescription>{help}</FieldDescription> : null}
        {inline ? (
          <div className="search">
            <Input
              value={ref}
              onChange={(e) => {
                setRef(e.target.value);
              }}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="characters"
              className="mono"
            />
            <Btn type="submit" look="go" sm flat>
              {button}
            </Btn>
          </div>
        ) : (
          <Input
            value={ref}
            onChange={(e) => {
              setRef(e.target.value);
            }}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters"
            className="mono"
          />
        )}
      </Field>
      {inline ? null : (
        <Btn type="submit" style={{ width: '100%' }}>
          {button}
        </Btn>
      )}
    </form>
  );
}
