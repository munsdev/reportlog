/** One sealed answer as a person reads it: a list joined, a yes/no in words. */
export function answerText(v) {
  if (Array.isArray(v)) return v.join(', ');
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return String(v);
}
