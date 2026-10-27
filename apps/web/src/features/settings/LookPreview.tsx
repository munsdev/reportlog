/**
 * The look previews: the site drawn small, in a look it is not wearing yet,
 * on a desktop and on a phone (decision 61; settings-and-admin.md §04).
 *
 * EACH FRAME IS ITS OWN DOCUMENT. A same-origin <iframe> with nothing loaded
 * in it (about:blank: no request, nothing for the site's frame rules to
 * refuse), holding a copy of the site's own stylesheets, with React drawing
 * into it through a portal. Two things make that worth it over scaling a
 * <div> on this page:
 *
 *   - The look is named on the frame's own <html>, exactly as the real site
 *     names it (data-palette, data-theme, data-panel-head, data-texture).
 *     The panel headings and textures in styles.css are keyed on <html>, so
 *     a <div> inside this page would draw them in the look the site wears
 *     now, not the one being previewed.
 *   - The phone frame is 390px wide to its own media queries and viewport
 *     units, so it lays out as a phone does even on a desktop screen.
 *
 * Every colour comes from the stylesheet; this file computes none. The
 * frames are pictures, so they are hidden from screen readers, kept out of
 * the tab order and made inert; the status line above them says in words
 * what is being previewed.
 */
import { parseBrand } from '@reportlog/contracts';
import type { BrandPart, Look } from '@reportlog/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Btn } from '@/mockup/Btn.tsx';
import { BrandRuns } from '@/mockup/Wordmark.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { St } from '@/mockup/St.tsx';
import { setLayoutAttributes, useSite } from '@/components/ui/site.tsx';
import { MotifHost } from '../looks/header-background/HeaderBackground.tsx';
import { usePreviewOptions } from '../looks/previewOptions.tsx';
import { BUILT_IN_CATALOGUE, layoutIn } from './looks.ts';
import type { LookCatalogue } from './looks.ts';

/** Name the look on a document's root, as site.tsx does, without remembering it. */
export function paintFrame(
  root: HTMLElement,
  look: Look,
  catalogue: LookCatalogue = BUILT_IN_CATALOGUE,
): void {
  const layout = layoutIn(look.theme, catalogue);
  root.setAttribute('data-palette', look.palette);
  root.setAttribute('data-theme', look.theme);
  setLayoutAttributes(root, layout);
}

/** Copy this page's stylesheets into a frame's head, once. */
function copyStyles(into: Document): void {
  if (into.head.querySelector('[data-rl-preview-styles]')) return;
  const marker = into.createElement('meta');
  marker.setAttribute('data-rl-preview-styles', '');
  into.head.append(marker);
  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    const copy = node.cloneNode(true) as HTMLElement;
    // Absolute, so the copy finds the same file whatever the frame's base.
    if (node instanceof HTMLLinkElement) copy.setAttribute('href', node.href);
    into.head.append(copy);
  }
}

/**
 * The two frames: the page inside (a 1280px desktop, a 390px phone) and the
 * scale it is drawn at. Written as numbers, so the box is the page times the
 * scale. `fit` draws them smaller for a column kept in view beside the
 * chooser, from a wide window up (`true`) or at every width (`'always'`).
 */
const PAGE = { desktop: [1280, 800], phone: [390, 640] } as const;
const SCALE = {
  normal: { desktop: 0.55, phone: 0.5 },
  fit: { desktop: 0.3, phone: 0.3 },
  always: { desktop: 0.3, phone: 0.3 },
} as const;

/** Whether the window is at least 1024px wide (the old `lg`). */
function useWindowWide() {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const q = window.matchMedia('(min-width: 1024px)');
    const read = () => {
      setWide(q.matches);
    };
    q.addEventListener('change', read);
    return () => {
      q.removeEventListener('change', read);
    };
  }, []);
  return wide;
}

interface FrameProps {
  look: Look;
  catalogue: LookCatalogue;
  size: keyof typeof PAGE;
  label: string;
  fit: FitMode;
  children: ReactNode;
}

/** `true` shrinks from lg up (the window's width); `'always'` shrinks at every width. */
type FitMode = boolean | 'always';

function PreviewFrame({ look, catalogue, size, label, fit, children }: FrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);

  // Set up whichever document the frame holds now. Some browsers swap the
  // first empty document for another when the frame finishes loading, so
  // this runs again on load; it is safe to run twice.
  const prepare = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    copyStyles(doc);
    doc.body.setAttribute('inert', '');
    doc.body.style.margin = '0';
    // The public pages are drawn on the dark ground, as the mock-up's front page is.
    doc.body.className = 'dark';
    let node = doc.getElementById('rl-preview');
    if (!node) {
      node = doc.createElement('div');
      node.id = 'rl-preview';
      doc.body.append(node);
    }
    setMount(node);
  }, []);

  useEffect(() => {
    prepare();
  }, [prepare]);

  const root = mount?.ownerDocument.documentElement;
  useEffect(() => {
    if (root) paintFrame(root, look, catalogue);
  }, [root, look, catalogue]);

  const wide = useWindowWide();
  const mode = fit === 'always' ? 'always' : fit && wide ? 'fit' : 'normal';
  const scale = SCALE[mode][size];
  const [pw, ph] = PAGE[size];
  return (
    <figure style={{ margin: 0, display: 'grid', gap: 8 }}>
      <figcaption className="eyebrow">{label}</figcaption>
      <div
        style={{
          overflow: 'hidden',
          width: pw * scale,
          height: ph * scale,
          maxWidth: '100%',
          border: '2px solid var(--rl-border-main)',
          borderRadius: size === 'phone' ? 18 : 'var(--rl-radius-sm)',
          background: 'var(--rl-background)',
        }}
      >
        <iframe
          ref={frame}
          title={`${label} preview`}
          aria-hidden="true"
          tabIndex={-1}
          onLoad={prepare}
          data-palette={look.palette}
          data-theme={look.theme}
          style={{
            display: 'block',
            border: 0,
            pointerEvents: 'none',
            transformOrigin: 'top left',
            width: pw,
            height: ph,
            transform: `scale(${String(scale)})`,
          }}
        />
      </div>
      {mount ? createPortal(children, mount) : null}
    </figure>
  );
}

/** The site, drawn small: what every frame shows, in the public pages' own markup. */
export function PreviewPage({ parts }: { parts: readonly BrandPart[] }) {
  // The header background being edited, if the Look screen is editing one.
  const draft = usePreviewOptions();
  return (
    <>
      <header className="site-head">
        <div className="wrap">
          <span className="wm">
            <BrandRuns parts={parts} />
          </span>
          <div className="head-right">
            <span className="menu-btn">MENU</span>
          </div>
        </div>
      </header>
      <MotifHost
        slot="hero"
        className="hero motif-host"
        {...(draft ? { options: draft.options, kit: draft.kit } : {})}
      >
        <div className="wrap">
          <span className="eyebrow">
            <BrandRuns parts={parts} />
          </span>
          <h1 className="display">
            Report what
            <br />
            <span className="two">you saw</span>
          </h1>
          <p className="tagline">Keep a record.</p>
          <p className="lede">
            Once a report is filed, nobody can alter or remove it without that being visible.
          </p>
          <div className="btn-row">
            <Btn look="go" lg tabIndex={-1}>
              Submit a report
            </Btn>
            <Btn look="ghost" lg tabIndex={-1}>
              Board
            </Btn>
          </div>
        </div>
      </MotifHost>
      <section className="zone" data-zone={draft?.options.zones === 'single' ? 'a' : 'b'}>
        <div className="wrap" style={{ display: 'grid', gap: 16 }}>
          <h2 className="h-page">A record of what happened</h2>
          <Panel title="RL-7K2M-4QXD" headingLevel={3}>
            <div className="chips">
              <St tone="confirmed">Confirmed</St>
              <St tone="serious">Serious</St>
              <St tone="open">Open</St>
            </div>
            <p>Polling place opened 40 minutes late.</p>
            <p className="m">RL-7K2M-4QXD · 3 Nov 14:02</p>
          </Panel>
          <div className="field">
            <span className="lbl">Check a report</span>
            <span className="input mono">RL-</span>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * The two frames. On a phone, the phone frame only, with a button to show
 * the desktop one under it: a 704px picture would not fit.
 */
export function LookFrames({
  look,
  name,
  catalogue = BUILT_IN_CATALOGUE,
  fit = false,
}: {
  look: Look;
  name?: readonly BrandPart[];
  /** Drawn smaller from lg up, for a column kept in view beside the chooser. */
  fit?: FitMode;
  /** Where a pack's theme finds its panel heading and texture. */
  catalogue?: LookCatalogue;
}) {
  const site = useSite();
  const parts = name ?? site.data?.name_parts ?? DEFAULT_PARTS;
  const [showDesktop, setShowDesktop] = useState(false);
  const wide = useWindowWide();
  const always = fit === 'always';
  const desktopShown = always || showDesktop || wide;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: always || (fit && wide) ? 16 : 28,
        }}
      >
        {desktopShown ? (
          <PreviewFrame look={look} catalogue={catalogue} size="desktop" label="Desktop" fit={fit}>
            <PreviewPage parts={parts} />
          </PreviewFrame>
        ) : null}
        <PreviewFrame look={look} catalogue={catalogue} size="phone" label="Phone" fit={fit}>
          <PreviewPage parts={parts} />
        </PreviewFrame>
      </div>
      {always || wide ? null : (
        <div>
          <Btn
            sm
            flat
            aria-expanded={showDesktop}
            onClick={() => {
              setShowDesktop(!showDesktop);
            }}
          >
            {showDesktop ? 'Hide the desktop preview' : 'Show the desktop preview'}
          </Btn>
        </div>
      )}
    </div>
  );
}

/** The software's own name, for a frame drawn before the site's has loaded. */
const DEFAULT_PARTS: readonly BrandPart[] = parseBrand('Report"Log"');
