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
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { Band, MockPage } from '@/mockup/Band.tsx';
import { Narrow } from '@/mockup/Narrow.tsx';

export interface PublicPageProps {
  title: string;
  /** Above the title. The site's name unless the page names something closer. */
  eyebrow?: ReactNode;
  lede?: ReactNode;
  /** Buttons or links that act on the whole page. At most one primary. */
  actions?: ReactNode;
  /** More inside the band, under the lede: tabs, figures. */
  band?: ReactNode;
  /** Side cards beside the page (`Panel`s). */
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
  children,
}: PublicPageProps) {
  const site = plainSiteName(useSite().data);
  useEffect(() => {
    document.title = `${title} · ${site}`;
  }, [title, site]);
  if (variant === 'plain')
    return (
      <Narrow max={width === 'wide' ? 896 : 640} gap={20}>
        <div style={{ display: 'grid', gap: 10 }}>
          <span className="eyebrow">{eyebrow ?? site}</span>
          <h1 className="h-page" id="h1">
            {title}
          </h1>
          {lede ? <p className="muted">{lede}</p> : null}
          {actions ? <div className="btn-row">{actions}</div> : null}
        </div>
        {aside ? <div className="grid2">{aside}</div> : null}
        {children}
      </Narrow>
    );
  return (
    <MockPage>
      <Band eyebrow={eyebrow ?? site} title={title} lead={lede}>
        {actions ? <div className="btn-row">{actions}</div> : null}
        {band}
      </Band>
      {aside ? (
        <div className="wrap two-col" style={{ paddingTop: 30 }}>
          <div className="prose">{children}</div>
          <aside aria-label={asideLabel ?? 'Related'} className="col">
            {aside}
          </aside>
        </div>
      ) : (
        <div className="wrap" style={{ paddingTop: 30 }}>
          <div className="prose" style={width === 'prose' ? { maxWidth: '65ch' } : undefined}>
            {children}
          </div>
        </div>
      )}
    </MockPage>
  );
}
