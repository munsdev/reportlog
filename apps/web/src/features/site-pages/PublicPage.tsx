/**
 * A public page's own layout. Two shapes, both from the mock-up:
 *
 *   variant="band"   (About, How, Legal, For journalists) a full-width band
 *                    with the headline, then the page and its side cards;
 *   variant="plain"  (the default: every page an email link opens, the forms
 *                    and notices) the eyebrow, the title and the content in
 *                    a narrow column, no band.
 *
 * In a band: the band holds
 * the eyebrow (the site's name), the one <h1>, the lede and any actions;
 * under it the page, optionally with a column of side cards. A drop-in for
 * the shared `Page`, which staff screens use. Running text keeps a 65ch
 * measure at every width.
 *
 * On a door the site's name is not asked for (useSite), and the eyebrow
 * falls back to the software's.
 */
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { BandPage, TwoCol, Wrap } from '@/components/ui/band.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { Eyebrow } from '@/components/ui/type.tsx';
import { cn } from '@/lib/utils.ts';

export interface PublicPageProps {
  title: string;
  /** Above the title. The site's name unless the page names something closer. */
  eyebrow?: ReactNode;
  lede?: ReactNode;
  /** Buttons or links that act on the whole page. At most one primary. */
  actions?: ReactNode;
  /** More inside the band, under the lede: tabs, figures. */
  band?: ReactNode;
  /** Side cards beside the page (`AsideCard`s). */
  aside?: ReactNode;
  asideLabel?: string;
  /** `band` for the text pages; `plain` for a page an email link opens. */
  variant?: 'band' | 'plain';
  /** `prose` keeps lines readable for text; `wide` is for tables and lists. */
  width?: 'prose' | 'wide';
  className?: string;
  children?: ReactNode;
}

export function PublicPage({
  title,
  eyebrow,
  lede,
  actions,
  band,
  aside,
  asideLabel,
  variant = 'plain',
  width = 'wide',
  className,
  children,
}: PublicPageProps) {
  if (variant === 'plain')
    return (
      <PlainPage
        title={title}
        eyebrow={eyebrow}
        lede={lede}
        actions={actions}
        aside={aside}
        width={width}
        className={className}
      >
        {children}
      </PlainPage>
    );
  const body = (
    <div className={cn('flex flex-col gap-6', width === 'prose' && !aside && 'max-w-prose')}>
      {children}
    </div>
  );
  return (
    <BandPage
      title={title}
      {...(eyebrow !== undefined ? { eyebrow } : {})}
      {...(lede !== undefined ? { lede } : {})}
      band={
        <>
          {actions ? <div className="flex flex-wrap items-center gap-3.5">{actions}</div> : null}
          {band}
        </>
      }
      {...(className ? { className } : {})}
    >
      {aside ? (
        <TwoCol aside={aside} {...(asideLabel ? { asideLabel } : {})}>
          {children}
        </TwoCol>
      ) : (
        body
      )}
    </BandPage>
  );
}

/**
 * The mock-up's page for an email link and its kind: the site's name over
 * the title, a line, the content. Narrow, because it is one task.
 */
function PlainPage({
  title,
  eyebrow,
  lede,
  actions,
  aside,
  width,
  className,
  children,
}: Omit<
  PublicPageProps,
  'variant' | 'band' | 'asideLabel' | 'eyebrow' | 'lede' | 'actions' | 'aside' | 'className'
> & {
  eyebrow: ReactNode | undefined;
  lede: ReactNode | undefined;
  actions: ReactNode | undefined;
  aside: ReactNode | undefined;
  className: string | undefined;
}) {
  const site = plainSiteName(useSite().data);
  useEffect(() => {
    document.title = `${title} · ${site}`;
  }, [title, site]);
  return (
    <div data-bleed>
      <Wrap className="pt-8 pb-16">
        <div
          className={cn(
            'flex flex-col gap-5',
            width === 'wide' ? 'max-w-[56rem]' : 'max-w-[40rem]',
            className,
          )}
        >
          <header className="flex flex-col gap-2.5">
            <Eyebrow>{eyebrow ?? site}</Eyebrow>
            <h1 className="font-display text-title">{title}</h1>
            {lede ? <p className="max-w-[62ch] text-ink-alt">{lede}</p> : null}
            {actions ? <div className="flex flex-wrap items-center gap-3.5">{actions}</div> : null}
          </header>
          {aside ? <div className="grid gap-3.5 sm:grid-cols-2">{aside}</div> : null}
          {children}
        </div>
      </Wrap>
    </div>
  );
}
