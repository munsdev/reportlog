/**
 * A location question at county depth, in the mock-up's markup (tips-2.html):
 * a State select, then a County select that follows it. The answer is one
 * code (a state alone is a real answer); the county list is bundled
 * (@reportlog/fields), so no request is made for it. Same behaviour as
 * features/form/CountyPicker.tsx, which the filing cards still use.
 */
import { countyOptions, stateOfPlace } from '@reportlog/fields';
import { useId } from 'react';
import { Field } from '../../mockup/Qcard.tsx';

export function ListCounty({
  states,
  value,
  onChange,
  labelledBy,
  describedBy,
  invalid,
}: {
  states: readonly { code: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
  labelledBy: string;
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
}) {
  const id = useId();
  const state = value ? stateOfPlace(value) : '';
  const counties = state ? countyOptions(state) : [];
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      style={{ display: 'grid', gap: 14 }}
    >
      <Field label="State" htmlFor={`${id}-state`}>
        <select
          className="sel"
          id={`${id}-state`}
          value={state}
          aria-invalid={invalid ? true : undefined}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        >
          <option value="">Choose a state</option>
          {states.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="County" htmlFor={`${id}-county`} optional>
        <select
          className="sel"
          id={`${id}-county`}
          value={state ? value : ''}
          disabled={!state}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        >
          {state ? (
            <option value={state}>Not sure which county</option>
          ) : (
            <option value="">Choose a state first</option>
          )}
          {counties.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
