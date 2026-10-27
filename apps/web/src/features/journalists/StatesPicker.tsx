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
import { SmBtn } from '../../mockup/SmBtn.tsx';
import { Choice, Choices } from '../../mockup/Choice.tsx';

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
    <fieldset
      style={{ display: 'grid', gap: 12, border: 0, padding: 0, margin: 0 }}
      aria-describedby={`${id}-count`}
    >
      <legend className="lbl">States you cover</legend>
      <div className="toolbar">
        <div className="search grow">
          <input
            id={`${id}-find`}
            type="search"
            aria-label="Find a state"
            placeholder="Find a state"
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
          <SmBtn onClick={apply}>Find</SmBtn>
        </div>
      </div>
      <div role="group" aria-label="States">
        <Choices>
          {find ? null : (
            <Choice
              multi
              name="st"
              checked={all}
              aria-invalid={invalid || undefined}
              onChange={(e) => {
                onChange(e.target.checked ? US_STATES.map((s) => s.code) : []);
              }}
            >
              All states
            </Choice>
          )}
          {shown.map((s) => (
            <Choice
              multi
              key={s.code}
              name="st"
              checked={value.includes(s.code)}
              onChange={(e) => {
                onChange(
                  e.target.checked
                    ? US_STATES.map((x) => x.code).filter((c) => c === s.code || value.includes(c))
                    : value.filter((x) => x !== s.code),
                );
              }}
            >
              {s.name}
            </Choice>
          ))}
        </Choices>
        {shown.length === 0 ? (
          <p className="m">No state is called that. Clear the search to see all.</p>
        ) : null}
      </div>
      <p id={`${id}-count`} aria-live="polite" className="m">
        {value.length === 1 ? '1 state chosen' : `${String(value.length)} states chosen`}
      </p>
    </fieldset>
  );
}
