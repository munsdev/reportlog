/**
 * Counts as the mock-up's `.bars`: a label, a track filled in proportion to
 * the largest count in the set, and the number. The number is always in the
 * text, so the bar is decoration and a screen reader loses nothing.
 */
export function Bars({
  items,
  label,
}: {
  items: readonly { label: string; value: number }[];
  /** What the set is, for a screen reader. */
  label: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="bars" role="table" aria-label={label}>
      {items.map((i) => (
        <div className="bar" role="row" key={i.label}>
          <span role="rowheader">{i.label}</span>
          <div className="track" aria-hidden="true">
            <div className="fill" style={{ width: `${String((i.value / max) * 100)}%` }} />
          </div>
          <span className="n" role="cell">
            {i.value.toLocaleString('en-US')}
          </span>
        </div>
      ))}
    </div>
  );
}
