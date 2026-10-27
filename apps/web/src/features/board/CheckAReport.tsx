import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Field, FieldDescription } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';

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
      className="flex flex-col gap-3"
    >
      <Field>
        <Label>{label}</Label>
        {help ? <FieldDescription>{help}</FieldDescription> : null}
        {inline ? (
          <div className="flex items-center gap-2">
            <Input
              value={ref}
              onChange={(e) => {
                setRef(e.target.value);
              }}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="characters"
              className="min-w-0 flex-1 font-mono"
            />
            <Button type="submit" variant="primary" className="shrink-0">
              {button}
            </Button>
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
            className="font-mono"
          />
        )}
      </Field>
      {inline ? null : (
        <Button type="submit" variant="secondary" block>
          {button}
        </Button>
      )}
    </form>
  );
}
