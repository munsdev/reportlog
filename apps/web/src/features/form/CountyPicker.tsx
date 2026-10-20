/**
 * A location question at county depth (owner decision 44): a state, then
 * that state's counties. Used by logbook cards and list forms alike.
 *
 * ONE QUESTION, ONE CARD. Both pickers are on the card from the start; the
 * only thing that changes is the county list, and only because the person
 * chose a state. Nothing moves anybody on.
 *
 * THE ANSWER IS ONE CODE. Choosing a state answers with the state, which
 * the county picker shows as "Not sure which county"; choosing a county
 * answers with the county's code. So there is never a half-made answer to
 * catch, and a state alone is a real answer, not a guess forced into a county.
 *
 * The county list is bundled with the page (@reportlog/fields): no request
 * is made for it, to this server or any other.
 */
import { countyOptions, stateOfPlace } from '@reportlog/fields';
import { useId } from 'react';
import { FieldReset } from '@/components/ui/field.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Select } from '@/components/ui/select.tsx';

interface Props {
  states: readonly { code: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
  labelledBy: string;
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
}

export function CountyPicker({ states, value, onChange, labelledBy, describedBy, invalid }: Props) {
  const id = useId();
  const state = value ? stateOfPlace(value) : '';
  const counties = state ? countyOptions(state) : [];
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="flex flex-col gap-4"
    >
      <FieldReset>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-state`}>State</Label>
          <Select
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
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-county`}>County, if you know it</Label>
          <Select
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
          </Select>
        </div>
      </FieldReset>
    </div>
  );
}
