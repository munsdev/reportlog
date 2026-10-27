import type { ReactNode } from 'react';
import { Fragment } from 'react';
import { usePageTitle } from './usePageTitle.ts';

/**
 * The mock-up's page band: `<section class="band">` with the eyebrow, the
 * one h1 (`.h-band`, fitted by site.js) and an optional lead. A "\n" in the
 * title becomes the mock-up's <br>. `motif` adds the header background host
 * (`.motif-host` with its `.ov` layer) that About and For journalists use.
 *
 * Wrap it in <MockPage>: the root of every mock-up page body.
 */
export function Band({
  eyebrow,
  title,
  tabTitle,
  lead,
  motif = false,
  leadSize,
  children,
}: {
  eyebrow: ReactNode;
  title: string;
  /** The browser tab's title when it differs from the headline. */
  tabTitle?: string;
  lead?: ReactNode;
  motif?: boolean;
  /** The mock-up's board pages set the lead smaller (`.95rem`). */
  leadSize?: string;
  children?: ReactNode;
}) {
  usePageTitle(tabTitle ?? title.replace(/\n/g, ' '));
  return (
    <section className={motif ? 'band motif-host' : 'band'} aria-labelledby="h1">
      {motif ? <div className="ov" data-slot="band" /> : null}
      <div className="wrap">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="h-band" id="h1">
          <Lines text={title} />
        </h1>
        {lead ? (
          <p className="lead" {...(leadSize ? { style: { fontSize: leadSize } } : {})}>
            {lead}
          </p>
        ) : null}
        {children}
      </div>
    </section>
  );
}

export function Lines({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((l, i) => (
        <Fragment key={i}>
          {i > 0 ? <br /> : null}
          {l}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The root of a mock-up page body. `data-bleed` tells the public frame
 * (styles.css, .rl-pad) to step aside, so the mock-up's own bands and wraps
 * run edge to edge as they do in the mock-up.
 */
export function MockPage({ children }: { children: ReactNode }) {
  return <div data-bleed>{children}</div>;
}
