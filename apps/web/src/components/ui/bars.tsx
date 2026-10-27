/**
 * Counts as bars (mock-up .bars): a label, a track filled in proportion to
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
    <ul aria-label={label} className="grid max-w-[640px] list-none gap-2.5 p-0 pt-1">
      {items.map((i) => (
        <li
          key={i.label}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 text-[0.95rem] min-[520px]:grid-cols-[minmax(120px,180px)_1fr_auto]"
        >
          <span className="min-w-0 break-words">{i.label}</span>
          <span
            aria-hidden="true"
            className="order-last col-span-2 h-[22px] overflow-hidden rounded-[4px] border-[1.5px] border-line bg-surface min-[520px]:order-none min-[520px]:col-span-1"
          >
            <span
              className="block h-full bg-ink"
              style={{ width: `${String((i.value / max) * 100)}%` }}
            />
          </span>
          <span className="min-w-[3ch] text-right font-mono tabular-nums">
            {i.value.toLocaleString('en-US')}
          </span>
        </li>
      ))}
    </ul>
  );
}
