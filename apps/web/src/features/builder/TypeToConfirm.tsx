/**
 * A one-way step confirmed by typing the logbook's title, not by pressing OK.
 * A dialog that only asks "are you sure?" is pressed through by habit; typing
 * a name is not.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Btn } from '@/mockup/StaffBtn.tsx';
import { Field, Problem, TextInput } from './controls.tsx';

interface Props {
  title: string;
  /** Say what happens, in a sentence or two, before anything is pressed. */
  children: ReactNode;
  action: string;
  primary?: boolean;
  onConfirm: () => Promise<unknown>;
}

export function TypeToConfirm({ title, children, action, primary = false, onConfirm }: Props) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === title.trim();

  return (
    <form
      className="dlg"
      onSubmit={(e) => {
        e.preventDefault();
        if (!matches) return;
        setBusy(true);
        setError(null);
        onConfirm()
          .catch((err: unknown) => {
            setError(err instanceof Error ? err : new Error('That did not work.'));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <div className="form-stack" style={{ gap: 8 }}>
        {children}
      </div>
      <Field label={`Type the title, “${title}”, to confirm`}>
        {(p) => (
          <TextInput
            {...p}
            value={typed}
            autoComplete="off"
            onChange={(e) => {
              setTyped(e.target.value);
            }}
          />
        )}
      </Field>
      <Problem error={error} />
      <Btn type="submit" variant={primary ? 'primary' : 'danger'} disabled={!matches || busy}>
        {action}
      </Btn>
    </form>
  );
}
