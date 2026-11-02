/**
 * Where an article is about: National, International, and any number of
 * states, counties or countries, added one at a time and shown as a list
 * with a Remove button each. A county is picked under its state; a state
 * with no county is the whole state.
 */
import { countyOptions, placeLabel, placeOptions } from '@reportlog/fields';
import { useId, useState } from 'react';
import { Btn } from '@/mockup/Btn.tsx';
import { CheckBox, Select } from '@/mockup/Field.tsx';

const ALL = placeOptions({ scope: 'both' });

export interface Where {
  national: boolean;
  international: boolean;
  places: string[];
}

export function PlacePicker({ value, onChange }: { value: Where; onChange: (w: Where) => void }) {
  const id = useId();
  const [state, setState] = useState('');
  const [county, setCounty] = useState('');
  const [country, setCountry] = useState('');
  const counties = state ? countyOptions(state) : [];
  const add = (code: string) => {
    if (!code || value.places.includes(code)) return;
    onChange({ ...value, places: [...value.places, code] });
  };
  return (
    <fieldset className="m-0 grid gap-3 border-0 p-0" aria-describedby={`${id}-help`}>
      <legend className="m">Where is it about?</legend>
      <span id={`${id}-help`} className="help">
        Choose everything that fits. It is shown on the map in each place you add.
      </span>
      <div className="grid gap-2">
        <CheckBox
          checked={value.national}
          onChange={(e) => {
            onChange({ ...value, national: e.target.checked });
          }}
        >
          National: the United States as a whole
        </CheckBox>
        <CheckBox
          checked={value.international}
          onChange={(e) => {
            onChange({ ...value, international: e.target.checked });
          }}
        >
          International: outside the United States
        </CheckBox>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="grid gap-1">
          <label className="m" htmlFor={`${id}-state`}>
            State
          </label>
          <Select
            id={`${id}-state`}
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setCounty('');
            }}
          >
            <option value="">Choose a state</option>
            {ALL.subdivisions.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1">
          <label className="m" htmlFor={`${id}-county`}>
            County (optional)
          </label>
          <Select
            id={`${id}-county`}
            value={county}
            disabled={counties.length === 0}
            onChange={(e) => {
              setCounty(e.target.value);
            }}
          >
            <option value="">The whole state</option>
            {counties.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <Btn
          sm
          disabled={!state}
          onClick={() => {
            add(county || state);
            setCounty('');
          }}
        >
          Add
        </Btn>
      </div>

      <div className="grid gap-2 sm:grid-cols-[2fr_auto] sm:items-end">
        <div className="grid gap-1">
          <label className="m" htmlFor={`${id}-country`}>
            Another country
          </label>
          <Select
            id={`${id}-country`}
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
            }}
          >
            <option value="">Choose a country</option>
            {ALL.countries
              .filter((c) => c.code !== 'US')
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
          </Select>
        </div>
        <Btn
          sm
          disabled={!country}
          onClick={() => {
            add(country);
            setCountry('');
          }}
        >
          Add
        </Btn>
      </div>

      {value.places.length > 0 ? (
        <ul className="m-0 grid list-none gap-1 p-0" aria-label="Places added">
          {value.places.map((code) => (
            <li key={code} className="flex items-center justify-between gap-3">
              <span>{placeLabel(code)}</span>
              <Btn
                sm
                flat
                aria-label={`Remove ${placeLabel(code)}`}
                onClick={() => {
                  onChange({ ...value, places: value.places.filter((p) => p !== code) });
                }}
              >
                Remove
              </Btn>
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}
