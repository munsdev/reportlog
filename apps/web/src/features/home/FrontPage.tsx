/**
 * The front page's shape, shared by the page a visitor sees and the same
 * page in edit mode (docs/design/screens/public.md §02).
 *
 * WHO IT IS FOR: somebody stressed, on a phone, who barely uses one, who
 * must be able to send a report within two minutes of arriving. So the top
 * of the page is only what she needs: the site's name, a big plain
 * headline, one sentence of what this is, the big buttons, a way to find
 * out what this is, and the emergency notice (decision 62, never removed).
 * Everything else sits underneath, quieter, in the order an administrator
 * chose, and may be hidden.
 *
 * ONE SHAPE, TWO FILLINGS. Edit mode passes fields where the view passes
 * words, so the page an administrator edits is the page a visitor sees, and
 * nothing moves when edit mode is switched on.
 */
import type { HomeSectionId } from '@reportlog/contracts';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card.tsx';
import { Eyebrow, Meta } from '@/components/ui/type.tsx';
import { CheckAReport } from '@/features/board/CheckAReport.tsx';
import { MapSlot } from '@/features/maps/MapSlot.tsx';
import { cn } from '@/lib/utils.ts';

/** One of the quieter sections, already drawn. */
export interface DrawnSection {
  id: HomeSectionId;
  node: ReactNode;
}

/** The map runs the width of the page; the rest share the two columns. */
const WIDE: ReadonlySet<HomeSectionId> = new Set(['map']);

export function FrontPageLayout({
  name,
  above,
  headline,
  lede,
  ways,
  helpNow,
  sections,
}: {
  name: string;
  /** Above everything: the Edit button, for somebody who may use it. */
  above?: ReactNode;
  headline: ReactNode;
  lede: ReactNode;
  ways: ReactNode;
  helpNow: ReactNode;
  sections: readonly DrawnSection[];
}) {
  return (
    <div className="flex flex-col gap-12 lg:gap-16">
      {above}
      {/* One strong column, centred on a desktop: the page is the headline
          and the buttons, so nothing sits beside them to compete. */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 lg:gap-8">
        <div className="flex flex-col gap-3">
          <Eyebrow>{name}</Eyebrow>
          {headline}
          {lede}
        </div>
        {ways}
        <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <Link to="/about" className="text-base font-semibold underline underline-offset-4">
            What is this? About this site
          </Link>
          <Meta>Anyone can file. Sealed and timestamped on arrival.</Meta>
        </p>
        {helpNow}
      </div>
      {sections.length ? (
        // `layout-split` is the hook a theme styles two-column regions by;
        // the Tailwind classes beside it are the layout until one does.
        <div className="layout-split grid gap-8 lg:grid-cols-2 lg:gap-10">
          {sections.map((s) => (
            <div
              key={s.id}
              className={cn('min-w-0 empty:hidden', WIDE.has(s.id) && 'lg:col-span-2')}
            >
              {s.node}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The headline, larger on a desktop so the page reads big and bold rather than a strip. */
export const HEADLINE_CLASS = 'font-display text-title lg:text-[calc(var(--rl-h1-size)*1.4)]';
export const LEDE_CLASS = 'max-w-[65ch] text-lede text-ink-alt whitespace-pre-wrap';

// ── the quieter sections, as a visitor sees them ─────────────────────────

export function IntroSection({ text }: { text: string }) {
  if (!text) return null;
  return (
    <section aria-label="What this archive is for">
      <p data-copy="home_intro" className="max-w-prose whitespace-pre-wrap">
        {text}
      </p>
    </section>
  );
}

export function CheckSection() {
  return (
    <Card variant="quiet" heading="Check a report">
      <CheckAReport help="Every report has a reference. Enter one to check it has not been changed." />
    </Card>
  );
}

/** Gone when no map is placed: absent, not an empty gap. */
export function MapSection() {
  return <MapSlot slot="home" />;
}

/** How many reports are published, when the archive is public; nothing otherwise. */
export function FiguresSection({ published }: { published: number | undefined }) {
  if (published === undefined) return null;
  return (
    <Card variant="quiet" heading="In numbers">
      <p className="flex items-baseline gap-3">
        <span className="font-display text-4xl font-bold">{published.toLocaleString('en-US')}</span>
        <span>{published === 1 ? 'report published' : 'reports published'}</span>
      </p>
      <p>
        <Link to="/board/numbers" className="underline underline-offset-4">
          All the numbers
        </Link>
      </p>
    </Card>
  );
}

const MORE: readonly { to: string; label: string }[] = [
  { to: '/board', label: 'Read the published reports' },
  { to: '/journalists/alerts', label: 'Get an email as reports come in' },
  { to: '/how', label: 'How to use this site' },
  { to: '/standards', label: 'How reports are moderated' },
];

export function LinksSection() {
  return (
    <Card variant="quiet" heading="More you can do">
      <ul className="flex flex-col gap-2">
        {MORE.map((l) => (
          <li key={l.to}>
            <a href={l.to} className="underline underline-offset-4">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
