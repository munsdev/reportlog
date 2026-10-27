/**
 * A staff page's frame (the mock-up's `spage`): the eyebrow ("ReportLog ·
 * Staff"), the title, the lede, the page's actions at the right, then any
 * tabs and the page. The area's other pages are in the staff sidebar
 * (StaffShell.tsx), so a staff page draws no row of area tabs; a page with
 * sections of its own passes `PTabs` (mockup/PTabs.tsx) as `tabs`.
 *
 * The markup is the mock-up's `spage`: `.phead` with `.phead-txt` (the
 * `.eyebrow`, the `h1#h1`, the `.lead`) and `.phead-act`, styled by
 * mockup/site.css. The page's body follows as its siblings in `.staff-main`
 * (the shell's grid), so this renders a fragment.
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';

export interface StaffPageProps {
  title: string;
  /** Replaces the whole eyebrow; most pages leave it and pass `area`. */
  eyebrow?: ReactNode;
  /** Which part of the app this is, after the site's name: "Staff" (the default), "Account", "Your organization". */
  area?: string;
  lede?: ReactNode;
  /** Buttons or links that act on the whole page. */
  actions?: ReactNode;
  /** The page's own sections (`.ptabs`), drawn under the head. */
  tabs?: ReactNode;
  /** The title in the mono face, for a code such as a reference. */
  mono?: boolean;
  /** Kept for callers; the staff column sets its own measure. */
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
  className,
  children,
}: StaffPageProps) {
  const siteName = plainSiteName(useSite().data);
  useEffect(() => {
    document.title = `${title} · ${siteName}`;
  }, [title, siteName]);
  return (
    <>
      <div className="phead">
        <div className="phead-txt">
          <span className="eyebrow">{eyebrow ?? `${siteName} · ${area}`}</span>
          <h1 id="h1" className={mono ? 'mono-title' : undefined}>
            {title}
          </h1>
          {lede ? <p className="lead">{lede}</p> : null}
        </div>
        {actions ? <div className="phead-act">{actions}</div> : null}
      </div>
      {tabs}
      {className ? <div className={className}>{children}</div> : children}
    </>
  );
}
