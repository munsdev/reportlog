/**
 * A staff page's frame (the mock-up's `spage`): the eyebrow ("ReportLog ·
 * Staff"), the title, the lede, the page's actions at the right, then any
 * tabs and the page. The area's other pages are in the staff sidebar
 * (StaffShell.tsx), so a staff page draws no row of area tabs; a page with
 * sections of its own passes a `TabRow` (AreaTabs.tsx) as `tabs`.
 *
 * It is `Page` with the staff area's measures: the title stops at 2.4rem
 * (the mock-up's `.phead h1`; the public look's title is far larger than a
 * working screen wants) and the lede is body size.
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { Eyebrow } from '@/components/ui/type.tsx';
import { cn } from '@/lib/utils.ts';

export interface StaffPageProps {
  title: string;
  /** Replaces the whole eyebrow; most pages leave it and pass `area`. */
  eyebrow?: ReactNode;
  /** Which part of the app this is, after the site's name: "Staff" (the default), "Account", "Your organization". */
  area?: string;
  lede?: ReactNode;
  /** Buttons or links that act on the whole page. */
  actions?: ReactNode;
  /** A `TabRow` for the page's own sections, drawn under the head. */
  tabs?: ReactNode;
  /** The title in the mono face, for a code such as a reference. */
  mono?: boolean;
  /** `prose` keeps lines readable for text; `wide` is for tables and boards. */
  width?: 'prose' | 'wide';
  className?: string | undefined;
  children?: ReactNode;
}

export function StaffPage({
  title,
  eyebrow,
  area = 'Staff',
  lede,
  actions,
  tabs,
  mono = false,
  width = 'wide',
  className,
  children,
}: StaffPageProps) {
  const siteName = plainSiteName(useSite().data);
  useEffect(() => {
    document.title = `${title} · ${siteName}`;
  }, [title, siteName]);
  return (
    <section
      className={cn(
        'page-sections flex flex-col gap-[18px]',
        width === 'prose' && 'max-w-prose',
        className,
      )}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
        <div className="flex max-w-[72ch] min-w-0 flex-[1_1_17.5rem] flex-col gap-1.5">
          <Eyebrow className="font-mono tracking-[0.12em]">
            {eyebrow ?? `${siteName} · ${area}`}
          </Eyebrow>
          <h1
            className={cn(
              'text-[clamp(1.6rem,3.6vw,2.4rem)] leading-[1.05] font-bold break-words',
              mono ? 'font-mono tracking-tight' : 'font-display',
            )}
          >
            {title}
          </h1>
          {lede ? <p className="text-ink-alt">{lede}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </header>
      {tabs}
      {children}
    </section>
  );
}
