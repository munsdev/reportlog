/**
 * A sealed answer in the words a person reads: a label, never a code; a
 * place's name; "Yes" rather than `true`. One function, so the review card,
 * the board, the digest, the desk and the counts read an answer the same way.
 *
 * LABELS ARE TODAY'S. A code keeps its meaning for good and a label may be
 * reworded (ruling 48), so showing the current label of a sealed code is
 * showing what it means. The sealed form definition still holds the words the
 * reporter was shown.
 */
import { placeCodeOf, placeLabel } from './gazetteer.ts';
import { labelForCode } from './options.ts';
import type { Answers, FieldDefinition } from './types.ts';

/** An hour of the day as a US reader says it. */
export function hourLabel(h: number): string {
  if (h === 0) return '12 am (midnight)';
  if (h === 12) return '12 pm (noon)';
  return `${String(h % 12)} ${h < 12 ? 'am' : 'pm'}`;
}

export function describeAnswer(
  field: Pick<FieldDefinition, 'kind' | 'settings'>,
  value: unknown,
  answers?: Partial<Answers>,
): string {
  const settings = field.settings ?? {};
  if (Array.isArray(value)) return value.map((v) => describeAnswer(field, v, answers)).join(', ');
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  switch (field.kind) {
    case 'choice_one':
    case 'choice_many':
      return typeof value === 'string' ? labelForCode(settings, value, answers) : '';
    case 'location': {
      const code = placeCodeOf(value, settings);
      return code ? placeLabel(code) : typeof value === 'string' ? value : '';
    }
    case 'place':
      return placeLabel(value);
    case 'number':
      if (settings.picker === 'hour' && typeof value === 'number' && Number.isInteger(value))
        return hourLabel(value);
      return typeof value === 'number' ? String(value) : '';
    default:
      return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }
}
