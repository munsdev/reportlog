/**
 * THE PUBLIC PAGE'S SHAPE, from the mock-up: a full-width band (eyebrow, the
 * headline, a lead, optionally figures and a row of tabs), then a wrap that
 * holds the page, often with a second column of cards beside it.
 *
 *   <BandPage eyebrow title lede>…</BandPage>     band + wrap
 *   <TwoCol aside={…}>…</TwoCol>                  the page and its side cards
 *   <AsideCard title>…</AsideCard>                one side card
 *   <Prose>…</Prose>                              running text at 66ch
 *   <SecHead num title>…</SecHead>                a numbered section head
 *
 * The root carries `data-bleed`, which tells the public frame to step aside
 * (styles.css, .rl-pad). The band's headline is the one place that will move
 * to the fitted headline when the look system's FitHeadline lands: it is
 * `BandTitle` below, nothing else needs to change.
 */
import { useEffect } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import type { LinkProps } from '@tanstack/react-router';
import { cn } from '@/lib/utils.ts';
import { plainSiteName, useSite } from './site.tsx';
import { Eyebrow } from './type.tsx';

const WRAP =
  'mx-auto w-full max-w-page px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]';

export function Wrap({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn(WRAP, className)} {...props} />;
}

/** The band's headline. A line break typed as "\n" is kept. */
export function BandTitle({
  children,
  id,
  className,
}: {
  children: string;
  id?: string;
  className?: string;
}) {
  const lines = children.split('\n');
  return (
    <h1 id={id} className={cn('rl-band-title text-ink', className)}>
      {lines.map((l, i) => (
        <span key={i}>
          {i > 0 ? <br /> : null}
          {l}
        </span>
      ))}
    </h1>
  );
}

export interface TabLinkItem {
  to: NonNullable<LinkProps['to']>;
  label: string;
  current: boolean;
}

/** The band's tabs: links with addresses, scrolling inside their own row. */
export function BandTabs({ label, tabs }: { label: string; tabs: readonly TabLinkItem[] }) {
  return (
    <nav
      aria-label={label}
      className="-mx-1 mt-1.5 flex overflow-x-auto border-b border-line [scrollbar-width:none] print:hidden"
    >
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          aria-current={t.current ? 'page' : undefined}
          activeProps={{}}
          className={cn(
            'label-face -mb-px inline-flex min-h-12 shrink-0 items-center border-b-[3px] px-4 text-[0.8125rem] whitespace-nowrap',
            t.current ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export interface BandPageProps {
  /** The browser tab's title, and the headline unless `heading` is given. */
  title: string;
  /** Above the headline. The site's name unless the page names something closer. */
  eyebrow?: ReactNode;
  /** The headline when it differs from the tab title (it may carry "\n"). */
  heading?: string;
  lede?: ReactNode;
  /** In the band, under the lede: figures, tabs, actions. */
  band?: ReactNode;
  /** Leave the wrap's own padding off (a page that lays itself out). */
  bare?: boolean;
  className?: string;
  children?: ReactNode;
}

export function BandPage({
  title,
  eyebrow,
  heading,
  lede,
  band,
  bare = false,
  className,
  children,
}: BandPageProps) {
  const site = plainSiteName(useSite().data);
  useEffect(() => {
    document.title = `${title} · ${site}`;
  }, [title, site]);
  return (
    <div data-bleed className="flex flex-col">
      <section className="border-b-(length:--rl-border-main) border-ink bg-surface">
        <Wrap className="grid gap-3 pt-[30px] pb-[26px]">
          <Eyebrow>{eyebrow ?? site}</Eyebrow>
          <BandTitle>{heading ?? title}</BandTitle>
          {lede ? <p className="max-w-[60ch] text-lede text-ink-alt">{lede}</p> : null}
          {band}
        </Wrap>
      </section>
      {bare ? (
        children
      ) : (
        <Wrap className={cn('flex flex-col gap-8 pt-8 pb-16', className)}>{children}</Wrap>
      )}
    </div>
  );
}

/** The page and its side cards (the mock-up's .two-col). */
export function TwoCol({
  aside,
  asideLabel,
  className,
  children,
}: {
  aside?: ReactNode;
  asideLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid items-start gap-7',
        aside ? 'min-[900px]:grid-cols-[1.4fr_1fr]' : '',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-8">{children}</div>
      {aside ? (
        <aside aria-label={asideLabel ?? 'Related'} className="grid min-w-0 gap-3.5">
          {aside}
        </aside>
      ) : null}
    </div>
  );
}

/** A side card: a small heading, a line, and usually one small button. */
export function AsideCard({
  title,
  plain = false,
  className,
  children,
}: {
  title: string;
  plain?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid content-start gap-2.5 rounded-card bg-surface p-[18px] text-ink',
        plain
          ? 'border-[1.5px] border-line'
          : 'border-(length:--rl-border-main) border-ink shadow-raised',
        '[&_p]:text-[0.95rem] [&_p]:text-ink-alt [&_a.btn-sm]:justify-self-start',
        className,
      )}
    >
      <h3 className="font-display text-[1.35rem] leading-none">{title}</h3>
      {children}
    </div>
  );
}

/** Running text, 66ch, with the mock-up's heading rhythm. */
export function Prose({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'grid max-w-[66ch] gap-3.5 text-ink-alt',
        '[&_a]:text-ink [&_a]:underline [&_a]:decoration-2 [&_a]:underline-offset-[3px]',
        '[&_h2]:mt-[18px] [&_h2]:font-display [&_h2]:text-[1.5rem] [&_h2]:leading-tight [&_h2]:text-ink',
        '[&_h3]:mt-[18px] [&_h3]:font-display [&_h3]:text-[1.15rem] [&_h3]:leading-tight [&_h3]:text-ink',
        '[&_ol]:grid [&_ol]:gap-1.5 [&_ol]:pl-[22px] [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-1.5 [&_ul]:pl-[22px]',
        className,
      )}
      {...props}
    />
  );
}

/** A section's head: its number, its heading and one line under it. */
export function SecHead({
  num,
  title,
  id,
  children,
}: {
  num?: string;
  title: string;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4 grid gap-1">
      <div className="flex items-baseline gap-3">
        {num ? <span className="font-mono text-sm text-muted">{num}</span> : null}
        <h2 id={id} className="font-display text-section">
          {title}
        </h2>
      </div>
      {children ? <p className="max-w-[62ch] text-ink-alt">{children}</p> : null}
    </div>
  );
}

/** A numbered list the mock-up's way: the numeral in the display face. */
export function Steps({
  items,
  className,
}: {
  items: readonly { title: string; body?: ReactNode }[];
  className?: string;
}) {
  return (
    <ol className={cn('grid list-none gap-3 p-0', className)}>
      {items.map((it, i) => (
        <li key={it.title} className="grid grid-cols-[34px_1fr] items-start gap-3 text-ink-alt">
          <span aria-hidden="true" className="font-display text-2xl leading-[1.1] text-ink">
            {i + 1}
          </span>
          <span>
            <b className="block font-display font-extrabold text-ink">{it.title}</b>
            {it.body}
          </span>
        </li>
      ))}
    </ol>
  );
}
