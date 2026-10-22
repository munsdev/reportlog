/**
 * A page's own layout, inside the site's header and footer: its one `<h1>`,
 * an optional line under it, optional actions beside it, then the content.
 * It also names the browser tab after the page and the site, because the
 * tab title is the first thing a screen reader says when a page changes.
 */
import { useEffect } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';
import { plainSiteName, useSite } from './site.tsx';

export interface PageProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: string;
  /** The line above the title, in the label face: the site's name on a staff page. */
  eyebrow?: ReactNode;
  lede?: ReactNode;
  /** Buttons or links that act on the whole page. At most one primary. */
  actions?: ReactNode;
  /** `prose` keeps lines readable for text; `wide` is for tables and boards. */
  width?: 'prose' | 'wide';
}

export function Page({
  title,
  eyebrow,
  lede,
  actions,
  width = 'wide',
  className,
  children,
  ...props
}: PageProps) {
  const siteName = plainSiteName(useSite().data);
  useEffect(() => {
    document.title = `${title} · ${siteName}`;
  }, [title, siteName]);
  return (
    <section
      className={cn(
        'page-sections flex flex-col gap-6',
        width === 'prose' && 'max-w-prose',
        className,
      )}
      {...props}
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          {eyebrow ? <p className="label-face text-xs text-muted">{eyebrow}</p> : null}
          <h1 className="font-display text-title font-bold">{title}</h1>
          {lede ? <p className="max-w-prose text-ink-alt">{lede}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
