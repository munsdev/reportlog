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
import { Panel } from '@/mockup/Panel.tsx';
import { St } from '@/mockup/St.tsx';
import { BrandName, setLayoutAttributes, useSite } from '@/components/ui/site.tsx';
import { FitHeadline } from '@/components/ui/fit-headline.tsx';
import { Eyebrow, Lede, Meta } from '@/components/ui/type.tsx';
import { Zone } from '@/components/ui/zone.tsx';
import { MotifHost } from '../looks/header-background/HeaderBackground.tsx';
import { usePreviewOptions } from '../looks/previewOptions.tsx';
import { cn } from '@/lib/utils.ts';
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
 * The two frames' sizes: the page inside (a 1280px desktop, a 390px phone)
 * and the box it is drawn small in (0.55 and 0.5 of it). Written out as
 * classes, not computed, so Tailwind finds them and no inline style is
 * needed.
 */
const SIZES = {
  desktop: { box: 'h-[440px] w-[704px]', page: 'h-[800px] w-[1280px] scale-[0.55]' },
  phone: { box: 'h-[320px] w-[195px] rounded-[18px]', page: 'h-[640px] w-[390px] scale-50' },
} as const;

/**
 * The same two frames drawn smaller, from lg up, for a column that stays in
 * view beside the chooser (`fit`). Three steps, because the column grows with
 * the window: 0.25 of the page's size where it is narrowest (the frames then
 * stack), 0.3 at xl (side by side, short enough to leave room for the status
 * card in a 720px window), and 0.4 desktop / 0.35 phone at 2xl. Below lg the
 * frames keep SIZES, so a phone is not shown a thumbnail.
 */
const FIT_SIZES = {
  desktop: {
    box: 'lg:h-[200px] lg:w-[320px] xl:h-[240px] xl:w-[384px] 2xl:h-[320px] 2xl:w-[512px]',
    page: 'lg:scale-[0.25] xl:scale-[0.3] 2xl:scale-[0.4]',
  },
  phone: {
    box: 'lg:h-[160px] lg:w-[98px] xl:h-[192px] xl:w-[117px] 2xl:h-[224px] 2xl:w-[137px]',
    page: 'lg:scale-[0.25] xl:scale-[0.3] 2xl:scale-[0.35]',
  },
} as const;

/**
 * For a column that is narrow whatever the window is (the Look screen beside
 * the staff sidebar): the small frames at every width, chosen by the caller
 * from the column's own width, not the window's.
 */
const ALWAYS_SIZES = {
  desktop: { box: 'h-[240px] w-[384px] max-w-full', page: 'scale-[0.3]' },
  phone: { box: 'h-[192px] w-[117px]', page: 'scale-[0.3]' },
} as const;

interface FrameProps {
  look: Look;
  catalogue: LookCatalogue;
  size: keyof typeof SIZES;
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

  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="label-face text-xs text-ink-alt">{label}</figcaption>
      <div
        className={cn(
          'overflow-hidden rounded-control border-2 border-ink bg-paper',
          fit === 'always' ? ALWAYS_SIZES[size].box : SIZES[size].box,
          fit === true && FIT_SIZES[size].box,
        )}
      >
        <iframe
          ref={frame}
          title={`${label} preview`}
          aria-hidden="true"
          tabIndex={-1}
          onLoad={prepare}
          data-palette={look.palette}
          data-theme={look.theme}
          className={cn(
            'pointer-events-none block origin-top-left border-0',
            fit === 'always' ? SIZES[size].page.replace(/scale-\S+/, '') : SIZES[size].page,
            fit === 'always' && ALWAYS_SIZES[size].page,
            fit === true && FIT_SIZES[size].page,
          )}
        />
      </div>
      {mount ? createPortal(children, mount) : null}
    </figure>
  );
}

/** The site, drawn small: what every frame shows. */
export function PreviewPage({ parts }: { parts: readonly BrandPart[] }) {
  // The header background being edited, if the Look screen is editing one.
  const draft = usePreviewOptions();
  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <div className="border-b-[6px] border-brand-on-deep bg-deep text-on-deep">
        <div className="mx-auto flex max-w-page items-center justify-between gap-4 px-4 py-3">
          <span className="font-display text-xl font-bold">
            <BrandName parts={parts} onDeep />
          </span>
          <span className="label-face rounded-control border-2 border-on-deep px-3 py-2 text-xs">
            Menu
          </span>
        </div>
      </div>
      <Zone tone="deep" {...(draft ? { zones: draft.options.zones } : {})}>
        <MotifHost
          slot="hero"
          className="py-10"
          {...(draft ? { options: draft.options, kit: draft.kit } : {})}
        >
          <div className="mx-auto flex max-w-page flex-col gap-3 px-4">
            <FitHeadline as="p" lines={['Report what', { text: 'you saw', two: true }]} />
            <p className="rl-tagline">Keep a record.</p>
          </div>
        </MotifHost>
      </Zone>
      <div className="mx-auto flex max-w-page flex-col gap-4 px-4 py-6">
        <Eyebrow>
          <BrandName parts={parts} />
        </Eyebrow>
        <h1 className="font-display text-title font-bold">A record of what happened</h1>
        <Lede>
          Once a report is filed, nobody can alter or remove it without that being visible.
        </Lede>
        <div className="flex flex-wrap gap-3">
          <Btn look="ink" sm flat tabIndex={-1}>Submit a report</Btn>
          <Btn sm flat tabIndex={-1} >
            Board
          </Btn>
        </div>
        <Panel title="RL-7K2M-4QXD" headingLevel={3} className="max-w-xl">
          <div className="flex flex-wrap gap-1.5">
            <St tone="confirmed">Confirmed</St>
            <St tone="serious">Serious</St>
            <St tone="open">Open</St>
          </div>
          <p>Polling place opened 40 minutes late.</p>
          <Meta>RL-7K2M-4QXD · 3 Nov 14:02</Meta>
        </Panel>
        <div className="flex max-w-md flex-col gap-1.5">
          <span className="label-face text-xs">Check a report</span>
          <span className="block rounded-control border-[1.5px] border-ink-alt bg-surface px-3 py-2.5 font-mono text-muted">
            RL-
          </span>
        </div>
      </div>
    </div>
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
  const always = fit === 'always';
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          'flex flex-wrap items-start',
          always ? 'gap-4' : fit ? 'gap-7 lg:gap-4' : 'gap-7',
        )}
      >
        <div className={cn(always || showDesktop ? 'block' : 'hidden', 'lg:block')}>
          <PreviewFrame look={look} catalogue={catalogue} size="desktop" label="Desktop" fit={fit}>
            <PreviewPage parts={parts} />
          </PreviewFrame>
        </div>
        <PreviewFrame look={look} catalogue={catalogue} size="phone" label="Phone" fit={fit}>
          <PreviewPage parts={parts} />
        </PreviewFrame>
      </div>
      <div className={cn(always ? 'hidden' : 'lg:hidden')}>
        <Btn sm flat
          
          aria-expanded={showDesktop}
          onClick={() => {
            setShowDesktop(!showDesktop);
          }}
        >
          {showDesktop ? 'Hide the desktop preview' : 'Show the desktop preview'}
        </Btn>
      </div>
    </div>
  );
}

/** The software's own name, for a frame drawn before the site's has loaded. */
const DEFAULT_PARTS: readonly BrandPart[] = parseBrand('Report"Log"');
