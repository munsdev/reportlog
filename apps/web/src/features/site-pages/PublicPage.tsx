/**
 * A public page's own layout (public.md §01): the eyebrow (the site's name),
 * the one <h1>, the lede, then the page. A drop-in for the shared `Page`,
 * which staff screens use without an eyebrow. Running text keeps a 65ch
 * measure at every width.
 *
 * On a door the site's name is not asked for (useSite), and the eyebrow
 * falls back to the software's.
 */
import { useEffect } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { Eyebrow, Lede } from '@/components/ui/type.tsx';
import { cn } from '@/lib/utils.ts';

export interface PublicPageProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: string;
  /** Above the title. The site's name unless the page names something closer. */
  eyebrow?: ReactNode;
  lede?: ReactNode;
  /** Buttons or links that act on the whole page. At most one primary. */
  actions?: ReactNode;
  /** `prose` keeps lines readable for text; `wide` is for tables and lists. */
  width?: 'prose' | 'wide';
}

export function PublicPage({
  title,
  eyebrow,
  lede,
  actions,
  width = 'wide',
  className,
  children,
  ...props
}: PublicPageProps) {
  const site = plainSiteName(useSite().data);
  useEffect(() => {
    document.title = `${title} · ${site}`;
  }, [title, site]);
  return (
    <section
      className={cn('flex flex-col gap-6', width === 'prose' && 'max-w-prose', className)}
      {...props}
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <Eyebrow>{eyebrow ?? site}</Eyebrow>
          <h1 className="font-display text-title">{title}</h1>
          {lede ? <Lede>{lede}</Lede> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
