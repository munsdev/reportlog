/**
 * A public page's own layout (mock-up: band, then the page): the band holds
 * the eyebrow (the site's name), the one <h1>, the lede and any actions;
 * under it the page, optionally with a column of side cards. A drop-in for
 * the shared `Page`, which staff screens use. Running text keeps a 65ch
 * measure at every width.
 *
 * On a door the site's name is not asked for (useSite), and the eyebrow
 * falls back to the software's.
 */
import type { ReactNode } from 'react';
import { BandPage, TwoCol } from '@/components/ui/band.tsx';
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
  width = 'wide',
  className,
  children,
}: PublicPageProps) {
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
