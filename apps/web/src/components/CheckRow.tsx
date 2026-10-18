/**
 * One verification check: what it means, and whether it holds. Status is
 * carried by words and a mark, never by colour alone.
 */
export interface CheckRowProps {
  ok: boolean;
  title: string;
  detail: string;
}

export function CheckRow({ ok, title, detail }: CheckRowProps) {
  return (
    <li className="flex gap-3 rounded-card border border-line bg-surface p-4">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full font-bold ${
          ok ? 'bg-confirmed text-on-confirmed' : 'bg-serious text-on-serious'
        }`}
      >
        {ok ? '✓' : '✕'}
      </span>
      <div>
        <p className="font-semibold">
          <span className="sr-only">{ok ? 'Holds: ' : 'Fails: '}</span>
          {title}
        </p>
        <p className="text-sm text-muted">{detail}</p>
      </div>
    </li>
  );
}
