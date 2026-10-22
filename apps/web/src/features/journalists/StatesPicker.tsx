/**
 * "States you cover": a searchable list of checkbox choice cards, "All
 * states" first, with a mono count line under it (public.md §09, account.md
 * §11). Used by the alert sign-up and the page that changes alerts.
 *
 * THE SEARCH APPLIES ON ENTER or with its own Find button, never as somebody
 * types (decision 59: nothing on the site filters as you type). It only
 * narrows what is shown; a state already ticked stays ticked when it is out
 * of view, and the count line always says how many are chosen.
 */
import { placeOptions } from '@reportlog/fields';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { CheckOption } from '@/components/ui/choice.tsx';
import { Input } from '@/components/ui/input.tsx';

export const US_STATES = placeOptions({ scope: 'us' }).subdivisions;

export function StatesPicker({
  value,
  onChange,
  invalid = false,
}: {
  value: readonly string[];
  onChange: (states: string[]) => void;
  invalid?: boolean;
}) {
  const id = useId();
  const [typed, setTyped] = useState('');
  const [find, setFind] = useState('');
  const all = US_STATES.length > 0 && US_STATES.every((s) => value.includes(s.code));
  const shown = find
    ? US_STATES.filter((s) => s.name.toLowerCase().includes(find.toLowerCase()))
    : US_STATES;
  const apply = () => {
    setFind(typed.trim());
  };
  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={`${id}-count`}>
      <legend className="label-face mb-1 text-[0.8125rem]">States you cover</legend>
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 grow flex-col gap-1">
          <label htmlFor={`${id}-find`} className="text-sm text-ink-alt">
            Find a state
          </label>
          <Input
            id={`${id}-find`}
            type="search"
            enterKeyHint="search"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
            }}
            onKeyDown={(e) => {
              // Enter finds; it must not send the form around the list.
              if (e.key === 'Enter') {
                e.preventDefault();
                apply();
              }
            }}
          />
        </div>
        <Button type="button" variant="secondary" onClick={apply}>
          Find
        </Button>
      </div>
      <div
        className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-card border border-ink-alt p-2"
        role="group"
        aria-label="States"
      >
        {find ? null : (
          <CheckOption
            id={`${id}-all`}
            label="All states"
            checked={all}
            aria-invalid={invalid || undefined}
            onCheckedChange={(on) => {
              onChange(on === true ? US_STATES.map((s) => s.code) : []);
            }}
          />
        )}
        {shown.map((s) => (
          <CheckOption
            key={s.code}
            id={`${id}-${s.code}`}
            label={s.name}
            checked={value.includes(s.code)}
            onCheckedChange={(on) => {
              onChange(
                on === true
                  ? US_STATES.map((x) => x.code).filter((c) => c === s.code || value.includes(c))
                  : value.filter((x) => x !== s.code),
              );
            }}
          />
        ))}
        {shown.length === 0 ? (
          <p className="p-2 text-ink-alt">No state is called that. Clear the search to see all.</p>
        ) : null}
      </div>
      <p id={`${id}-count`} aria-live="polite" className="font-mono text-sm">
        {value.length === 1 ? '1 state chosen' : `${String(value.length)} states chosen`}
      </p>
    </fieldset>
  );
}
