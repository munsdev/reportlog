/**
 * One control per kind of question. The card's heading IS the question, so
 * it names the control (`labelledBy`) and there is no second label to drift
 * from it.
 *
 * Choosing an option never moves anybody on and never changes what is on
 * this card: if an answer changes what is asked, that happens on the next one.
 */
import type { FormQuestion } from '@reportlog/contracts';
import {
  countyOptions,
  depthOf,
  hourLabel,
  offeredOptions,
  optionCode,
  optionLabel,
} from '@reportlog/fields';
import type { Answers, FieldSettings } from '@reportlog/fields';
import { useId } from 'react';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { RadioGroup, RadioOption } from '@/components/ui/radio-group.tsx';
import { Select } from '@/components/ui/select.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { CountyPicker } from './CountyPicker.tsx';
import type { RawValue } from './walk.ts';

const INPUT_TYPES: Record<string, string> = {
  date: 'date',
  time: 'time',
  datetime: 'datetime-local',
  number: 'number',
  email: 'email',
  url: 'url',
};

interface ControlProps {
  question: FormQuestion;
  value: RawValue | undefined;
  /** Undefined clears the answer: an unticked box answers nothing. */
  onChange: (value: RawValue | undefined) => void;
  labelledBy: string;
  describedBy?: string | undefined;
  invalid: boolean;
  /**
   * The answers given before this question, as they would be sealed, and as
   * the controls hold them. Decided before the card: an option list chosen by
   * an earlier answer, and the state a county sits in, which is on this card.
   */
  answers?: Answers | undefined;
  raw?: Record<string, RawValue | undefined> | undefined;
}

interface Choice {
  value: string;
  label: string;
}

/** What is offered: the CODE is what is sent, the label is what is read. */
const optionsOf = (q: FormQuestion, answers?: Answers): Choice[] =>
  (offeredOptions(q.settings as FieldSettings, answers ?? {}) ?? []).map((o) => ({
    value: optionCode(o),
    label: optionLabel(o),
  }));
const numberSetting = (q: FormQuestion, key: string): number | undefined =>
  typeof q.settings[key] === 'number' ? q.settings[key] : undefined;

export function QuestionControl(props: ControlProps) {
  const { question: q, value, onChange, labelledBy, describedBy, invalid } = props;
  const text = typeof value === 'string' ? value : '';
  const common = {
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
    'aria-invalid': invalid || undefined,
  };

  // A TICK BOX: ticked answers yes, unticked answers nothing at all.
  if (q.kind === 'yes_no' && q.settings.checkbox === true) {
    const id = `${labelledBy}-box`;
    return (
      <div className="flex items-center gap-3">
        <Checkbox
          id={id}
          checked={text === 'yes'}
          aria-describedby={describedBy}
          onCheckedChange={(on) => {
            onChange(on === true ? 'yes' : undefined);
          }}
        />
        <Label htmlFor={id} className="font-normal">
          {q.label}
        </Label>
      </div>
    );
  }
  // Either/or answers are tiles, never a checkbox: a checkbox cannot tell
  // "no" from "did not answer", and these can be either. (The tick box above
  // is the one yes/no whose "no" IS "did not answer", by its setting.)
  if (q.kind === 'yes_no' || q.kind === 'evidence_declaration') {
    // The declaration's words say what is being answered: "Yes" alone on a
    // card asking whether somebody has footage reads as agreeing to send it.
    const [yes, no] =
      q.kind === 'yes_no' ? ['Yes', 'No'] : ['Yes, I have something', 'No, I do not'];
    return (
      <RadioGroup value={text} onValueChange={onChange} {...common}>
        <RadioOption value="yes" label={yes} />
        <RadioOption value="no" label={no} />
      </RadioGroup>
    );
  }
  const options = optionsOf(q, props.answers);
  if (q.kind === 'choice_one' || (q.kind === 'place' && options.length && !q.settings.allowOther)) {
    return (
      <RadioGroup value={text} onValueChange={onChange} {...common}>
        {options.map((o) => (
          <RadioOption key={o.value} value={o.value} label={o.label} />
        ))}
      </RadioGroup>
    );
  }
  if (q.kind === 'choice_many') {
    return <ManyChoices {...props} options={options} />;
  }
  if (q.kind === 'number' && q.settings.picker === 'hour') {
    return (
      <Select
        value={text}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        {...common}
      >
        <option value="">Choose an hour</option>
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={String(h)}>
            {hourLabel(h)}
          </option>
        ))}
      </Select>
    );
  }
  if (q.kind === 'location' && q.settings.code === 'postal') {
    // A US state by its two letters: the same list, the code without `US-`.
    return (
      <Select
        value={text}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        {...common}
      >
        <option value="">Choose a state</option>
        {(q.places?.subdivisions ?? []).map((p) => (
          <option key={p.code} value={p.code.replace(/^US-/, '')}>
            {p.name}
          </option>
        ))}
      </Select>
    );
  }
  if (q.kind === 'location' && q.settings.code === 'fips') {
    // A county by its five digits, from the state chosen beside it. Inactive
    // until a state is chosen; the card clears it when the state changes.
    const within = typeof q.settings.within === 'string' ? q.settings.within : '';
    const given = props.raw?.[within];
    const state = typeof given === 'string' ? given : '';
    const counties = state ? countyOptions(`US-${state}`) : [];
    return (
      <Select
        value={state ? text : ''}
        disabled={!state}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        {...common}
      >
        <option value="">{state ? 'Choose a county' : 'Choose a state first'}</option>
        {counties.map((p) => (
          <option key={p.code} value={p.code.slice(-5)}>
            {p.name}
          </option>
        ))}
      </Select>
    );
  }
  if (q.kind === 'location') {
    // A PICKER, because the server seals a code (US-AZ, DE) and never a name.
    const places = q.places ?? { subdivisions: [], countries: [] };
    if (depthOf(q.settings) === 'county') {
      return (
        <CountyPicker
          states={places.subdivisions}
          value={text}
          onChange={onChange}
          labelledBy={labelledBy}
          describedBy={describedBy}
          invalid={invalid}
        />
      );
    }
    const both = places.subdivisions.length > 0 && places.countries.length > 0;
    const group = (label: string, list: { code: string; name: string }[]) =>
      both ? (
        <optgroup key={label} label={label}>
          {list.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ) : (
        list.map((p) => (
          <option key={p.code} value={p.code}>
            {p.name}
          </option>
        ))
      );
    return (
      <Select
        value={text}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        {...common}
      >
        <option value="">Choose a place</option>
        {group('United States', places.subdivisions)}
        {group('Countries', places.countries)}
      </Select>
    );
  }
  if (q.kind === 'long_text') {
    return (
      <Textarea
        value={text}
        rows={8}
        maxLength={numberSetting(q, 'maxLength') ?? 5000}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        {...common}
      />
    );
  }
  return (
    <Input
      type={INPUT_TYPES[q.kind] ?? 'text'}
      value={text}
      {...(q.kind === 'short_text' || q.kind === 'place'
        ? { maxLength: numberSetting(q, 'maxLength') ?? 200 }
        : {})}
      {...(q.kind === 'number'
        ? { min: numberSetting(q, 'min'), max: numberSetting(q, 'max') }
        : {})}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      {...common}
    />
  );
}

function ManyChoices({
  value,
  onChange,
  labelledBy,
  describedBy,
  options,
}: ControlProps & { options: Choice[] }) {
  const id = useId();
  const picked = Array.isArray(value) ? value : [];
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="flex flex-col gap-3"
    >
      {options.map((o, i) => (
        <div key={o.value} className="flex items-center gap-3">
          <Checkbox
            id={`${id}-${String(i)}`}
            checked={picked.includes(o.value)}
            onCheckedChange={(on) => {
              // The order sent is the screen's, which is the operator's.
              const next = new Set(picked);
              if (on === true) next.add(o.value);
              else next.delete(o.value);
              onChange(options.map((x) => x.value).filter((x) => next.has(x)));
            }}
          />
          <Label htmlFor={`${id}-${String(i)}`} className="font-normal">
            {o.label}
          </Label>
        </div>
      ))}
    </div>
  );
}
