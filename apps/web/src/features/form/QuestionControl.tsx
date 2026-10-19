/**
 * One control per kind of question. The card's heading IS the question, so
 * it names the control (`labelledBy`) and there is no second label to drift
 * from it.
 *
 * Choosing an option never moves anybody on and never changes what is on
 * this card: if an answer changes what is asked, that happens on the next one.
 */
import type { FormQuestion } from '@reportlog/contracts';
import { useId } from 'react';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { RadioGroup, RadioOption } from '@/components/ui/radio-group.tsx';
import { Select } from '@/components/ui/select.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
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
  onChange: (value: RawValue) => void;
  labelledBy: string;
  describedBy?: string | undefined;
  invalid: boolean;
}

const optionsOf = (q: FormQuestion): string[] =>
  Array.isArray(q.settings.options) ? q.settings.options.filter((o) => typeof o === 'string') : [];
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

  // Either/or answers are tiles, never a checkbox: a checkbox cannot tell
  // "no" from "did not answer", and these can be either.
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
  const options = optionsOf(q);
  if (q.kind === 'choice_one' || (q.kind === 'place' && options.length && !q.settings.allowOther)) {
    return (
      <RadioGroup value={text} onValueChange={onChange} {...common}>
        {options.map((o) => (
          <RadioOption key={o} value={o} label={o} />
        ))}
      </RadioGroup>
    );
  }
  if (q.kind === 'choice_many') {
    return <ManyChoices {...props} options={options} />;
  }
  if (q.kind === 'location') {
    // A PICKER, because the server seals a code (US-AZ, DE) and never a name.
    const places = q.places ?? { subdivisions: [], countries: [] };
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
}: ControlProps & { options: string[] }) {
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
        <div key={o} className="flex items-center gap-3">
          <Checkbox
            id={`${id}-${String(i)}`}
            checked={picked.includes(o)}
            onCheckedChange={(on) => {
              // The order sent is the screen's, which is the operator's.
              const next = new Set(picked);
              if (on === true) next.add(o);
              else next.delete(o);
              onChange(options.filter((x) => next.has(x)));
            }}
          />
          <Label htmlFor={`${id}-${String(i)}`} className="font-normal">
            {o}
          </Label>
        </div>
      ))}
    </div>
  );
}
