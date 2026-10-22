/**
 * A numbered section of a long text page (About, How to use this): a small
 * label, a heading and paragraphs, linked by id so a contents list can
 * point at it. Static: nothing in it fetches.
 */
import type { ReactNode } from 'react';

export function ProseSection({
  id,
  label,
  title,
  children,
}: {
  id: string;
  label?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-20 flex-col gap-3 leading-[1.55]"
    >
      {/* The numbered eyebrow ("Part one · 01"), in the label face like every eyebrow. */}
      {label ? <p className="label-face text-xs text-muted">{label}</p> : null}
      <h2 id={`${id}-title`} className="font-display text-section">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A contents list for the sections above, in order. */
export function Contents({
  label,
  items,
}: {
  label: string;
  items: readonly { id: string; title: string }[];
}) {
  return (
    <nav aria-label={label} className="rounded-card bg-paper-alt p-5">
      <p className="label-face mb-2 text-xs text-ink-alt">{label}</p>
      <ol className="flex list-decimal flex-col pl-6">
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              className="inline-flex min-h-11 items-center underline underline-offset-2"
            >
              {i.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
