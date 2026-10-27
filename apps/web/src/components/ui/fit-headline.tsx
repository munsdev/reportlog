/**
 * The big headline: it fits its box.
 *
 * The size scales between the theme's smallest and largest (`--rl-fit-min`
 * and `--rl-fit-max`, or the band pair with `band`), a line break the editor
 * typed is kept (each typed line is one entry of `lines`), and a line that
 * cannot fit even at the smallest size wraps to two rows. It re-fits when
 * the box changes width, when the fonts arrive, and when Easier reading or
 * the look changes (a different theme is a different range).
 *
 *   <FitHeadline lines={['Report what', { text: 'you saw', two: true }]} />
 *
 * `two` marks the line the theme may draw outlined, muted or in the brand
 * colour (`data-second` on <html>, styles.css). Without script it is the
 * stylesheet's clamp, which is already near right.
 *
 * The arithmetic is features/looks/fit.ts; this only measures. It writes a
 * font size onto the element itself (not JSX style), which is what a
 * measured value is, and the Client-First suite allows.
 */
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';
import { WRAP_ROWS, decideFit, effectiveRange } from '@/features/looks/fit.ts';

export type HeadlineLine = string | { text: ReactNode; two?: boolean };

export interface FitHeadlineProps {
  lines: readonly HeadlineLine[];
  as?: ElementType;
  /** A section band's headline: the smaller pair of sizes. */
  band?: boolean;
  /** Never larger than this, in px, whatever the theme allows. */
  maxSize?: number;
  className?: string;
  id?: string;
}

function numberVar(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const n = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Fit one headline element now. Exported for the Look screen's previews and the tests. */
export function fitElement(h: HTMLElement, opts: { band: boolean; maxSize?: number }): void {
  const avail = h.clientWidth;
  if (!avail) return;
  const doc = h.ownerDocument;
  const view = doc.defaultView;
  if (!view) return;
  const cs = view.getComputedStyle(h);
  const band = opts.band;
  const theme = {
    min: numberVar(cs, band ? '--rl-band-min' : '--rl-fit-min', 32),
    max: numberVar(cs, band ? '--rl-band-max' : '--rl-fit-max', 120),
  };
  const easy = doc.documentElement.hasAttribute('data-easy');
  const range = effectiveRange(theme, { maxSize: opts.maxSize, easy });
  const lines = [...h.querySelectorAll<HTMLElement>(':scope > .ln')];
  const widest = () => lines.reduce((w, l) => Math.max(w, l.scrollWidth), 0);
  const size = (px: number) => {
    h.style.fontSize = `${String(px)}px`;
  };

  h.toggleAttribute('data-wrap', false);
  const choice = decideFit(range, {
    oneLine: (px) => {
      size(px);
      return widest() <= avail;
    },
    wrapped: (px) => {
      h.toggleAttribute('data-wrap', true);
      size(px);
      let ok = widest() <= avail;
      if (ok) {
        const lh = Number.parseFloat(view.getComputedStyle(h).lineHeight) || px;
        ok = lines.every((l) => l.getBoundingClientRect().height <= lh * WRAP_ROWS);
      }
      h.toggleAttribute('data-wrap', false);
      return ok;
    },
  });
  h.toggleAttribute('data-wrap', choice.wrap);
  size(choice.size);
}

export function FitHeadline({
  lines,
  as: Tag = 'h1',
  band = false,
  maxSize,
  className,
  id,
}: FitHeadlineProps) {
  const ref = useRef<HTMLElement>(null);
  const autoId = useId();
  const opts = { band, ...(maxSize === undefined ? {} : { maxSize }) };
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  // The text is a dependency: a new headline is a new fit.
  const text = lines
    .map((l) => (typeof l === 'string' ? l : typeof l.text === 'string' ? l.text : '\u0000'))
    .join('\n');

  useLayoutEffect(() => {
    const h = ref.current;
    if (!h) return;
    const doc = h.ownerDocument;
    const view = doc.defaultView;
    const fit = () => {
      fitElement(h, optsRef.current);
    };
    fit();

    // A change of width is the only size change that needs a new fit: the
    // fit itself changes the height, and reacting to that would never end.
    let width = h.clientWidth;
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (h.clientWidth !== width) {
              width = h.clientWidth;
              fit();
            }
          });
    resize?.observe(h);
    // Easier reading, a new palette or theme: a different range or face.
    const attrs = new MutationObserver(fit);
    attrs.observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ['data-easy', 'data-theme', 'data-palette', 'data-second'],
    });
    const fonts = doc.fonts as FontFaceSet | undefined;
    void fonts?.ready.then(fit);
    view?.addEventListener('resize', fit);
    return () => {
      resize?.disconnect();
      attrs.disconnect();
      view?.removeEventListener('resize', fit);
    };
  }, [text, band, maxSize]);

  return (
    <Tag
      ref={ref}
      id={id ?? autoId}
      data-band={band ? '' : undefined}
      className={cn('rl-display', className)}
    >
      {lines.map((line, i) => {
        const entry = typeof line === 'string' ? { text: line, two: false } : line;
        return (
          <span key={i} className={cn('ln', entry.two && 'two')}>
            {entry.text}
          </span>
        );
      })}
    </Tag>
  );
}
