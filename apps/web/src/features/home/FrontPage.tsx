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
import type { HomeSectionId, PublicSocialLink } from '@reportlog/contracts';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card.tsx';
import { SocialLinks } from '@/components/ui/social-links.tsx';
import { Eyebrow } from '@/components/ui/type.tsx';
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
  slogan,
  lede,
  ways,
  helpNow,
  sections,
}: {
  name: string;
  /** Above everything: the Edit button, for somebody who may use it. */
  above?: ReactNode;
  headline: ReactNode;
  /** The slogan bar, under the headline; nothing when the operator wrote none. */
  slogan?: ReactNode;
  lede: ReactNode;
  ways: ReactNode;
  helpNow: ReactNode;
  sections: readonly DrawnSection[];
}) {
  return (
    <div className="flex flex-col gap-12 lg:gap-16">
      {above}
      {/* THE SAME WIDTH AS THE SECTIONS BELOW. A narrow centred column on
          top of full-width sections read as two pages stacked. The text keeps
          its own reading measure (LEDE_CLASS); the buttons share a grid. */}
      {/* TWO COLUMNS ON A DESKTOP, the familiar landing page: what this is
          on the left, the ways in on the right. Stacked on anything
          narrower, the buttons under the words. */}
      <div className="flex w-full flex-col gap-6 lg:gap-8">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center lg:gap-12">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <Eyebrow>{name}</Eyebrow>
              {headline}
              {slogan}
              {lede}
            </div>
            <p className="flex flex-col gap-1">
              <Link to="/about" className="text-base font-semibold underline underline-offset-4">
                What is this? About this site
              </Link>
            </p>
          </div>
          {ways}
        </div>
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
export const HEADLINE_CLASS = 'font-display text-title lg:text-[calc(var(--rl-h1-size)*1.15)]';
/**
 * The slogan in a solid bar under the headline: the text colour as ground,
 * the page's own ground as text, so it holds in every palette. As wide as its
 * words and no wider, and wrapping rather than overflowing at 390px.
 */
export function Slogan({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p
      data-slogan
      className="w-fit max-w-full rounded-control bg-ink px-4 py-2.5 font-display text-lg leading-tight text-paper sm:text-xl"
    >
      {text}
    </p>
  );
}

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
      <CheckAReport help={null} />
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
  { to: '/journalists', label: 'For journalists: alerts and desk access' },
  { to: '/how', label: 'How to use this site' },
  { to: '/how?tab=next', label: 'How reports are moderated' },
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

/**
 * The site's accounts elsewhere, named, for somebody who would rather follow
 * it where they already are. Gone when none is switched on.
 */
export function SocialSection({
  links,
  name,
}: {
  links: readonly PublicSocialLink[] | undefined;
  name: string;
}) {
  if (!links?.length) return null;
  return (
    <Card variant="quiet" heading="Follow us elsewhere">
      <SocialLinks links={links} siteName={name} variant="list" />
    </Card>
  );
}
