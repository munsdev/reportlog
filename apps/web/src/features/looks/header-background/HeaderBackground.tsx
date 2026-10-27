/**
 * The header background: layers behind a headline, drawn from the options
 * the owner chose on the Look screen (scene.ts decides what; this draws it).
 *
 *   <MotifHost slot="hero" className="py-16">
 *     <FitHeadline ... />
 *   </MotifHost>
 *
 * The host is its own stacking context, so a layer can never reach over the
 * navigation bar or a form; the layers are `pointer-events: none` and
 * `aria-hidden`. Never behind a form question or report text: only a host
 * carries one. Motion is off under `prefers-reduced-motion`, under the
 * owner's "Still", and under Easier reading (which hides the layers).
 *
 * Every colour is a current colour (the text colour of the zone the host
 * sits in), and the picture is served from this site. Dynamic values are
 * written onto the element itself, not as JSX style, which the Client-First
 * suite rules out for components.
 */
import type { LookOptions } from '@reportlog/contracts';
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useSite } from '@/components/ui/site.tsx';
import { cn } from '@/lib/utils.ts';
import { useKit } from './kits.ts';
import { DEFAULT_OPTIONS } from './options.ts';
import { buildScene, maskFor } from './scene.ts';
import type { Kit, Layer, PatternGeometry, Slot } from './scene.ts';

function Pattern({ g }: { g: PatternGeometry }) {
  if (g.kind === 'stripes') {
    return (
      <g transform="skewY(-9)" fill="currentColor" fillOpacity=".55">
        {g.ys.map((y) => (
          <rect key={y} x={0} y={y} width={1200} height={30} />
        ))}
      </g>
    );
  }
  if (g.kind === 'stars') {
    return (
      <g fill="currentColor">
        {g.stars.map((s, i) => (
          <polygon key={i} points={s.points} fillOpacity={s.opacity} />
        ))}
      </g>
    );
  }
  return (
    <g fill="none" stroke="currentColor" strokeOpacity=".8">
      {g.ys.map((y) => (
        <line key={y} x1={0} y1={y} x2={1200} y2={y} strokeWidth={2} />
      ))}
      <line x1={84} y1={0} x2={84} y2={900} strokeWidth={3} />
      <line x1={94} y1={0} x2={94} y2={900} strokeWidth={1.5} />
    </g>
  );
}

function ShapeLayer({ layer }: { layer: Extract<Layer, { type: 'shape' }> }) {
  const { box: B, style, src } = layer;
  const clip = `rl-clip-${layer.key}`;
  const vb = B.vb;
  return (
    <svg
      viewBox="0 0 1200 900"
      preserveAspectRatio="xMaxYMid slice"
      aria-hidden="true"
      focusable="false"
      className={cn('shp', src && `tone-${layer.tone}`)}
      data-depth={layer.depth}
      opacity={layer.opacity}
    >
      <svg
        x={B.x.toFixed(1)}
        y={B.y.toFixed(1)}
        width={B.w.toFixed(1)}
        height={B.h.toFixed(1)}
        viewBox={vb.join(' ')}
        preserveAspectRatio="xMidYMid meet"
      >
        {src ? (
          <>
            <defs>
              <clipPath id={clip}>
                <path d={layer.path} />
              </clipPath>
            </defs>
            <image
              href={src}
              x={vb[0]}
              y={vb[1]}
              width={vb[2]}
              height={vb[3]}
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#${clip})`}
            />
            <path
              d={layer.path}
              fill="none"
              stroke="currentColor"
              strokeWidth={(vb[2] / 300).toFixed(2)}
              strokeOpacity=".6"
            />
          </>
        ) : style === 'outline' ? (
          <path
            d={layer.path}
            fill="none"
            stroke="currentColor"
            strokeWidth={(vb[2] / 240).toFixed(2)}
            strokeLinejoin="round"
          />
        ) : (
          <path d={layer.path} fill="currentColor" />
        )}
      </svg>
    </svg>
  );
}

/** A picture laid on an element, positioned by the focus point. Values, not a look. */
function paintPhoto(el: HTMLElement | null, src: string, focus: number) {
  if (!el) return;
  el.style.backgroundImage = `url("${src}")`;
  el.style.backgroundPosition = `${String(focus)}% 50%`;
}

function LayerView({ layer }: { layer: Layer }) {
  if (layer.type === 'pattern') {
    return (
      <svg
        viewBox="0 0 1200 900"
        preserveAspectRatio="xMaxYMid slice"
        aria-hidden="true"
        focusable="false"
        className="pat"
        data-depth={layer.depth}
      >
        <Pattern g={layer.geometry} />
      </svg>
    );
  }
  if (layer.type === 'shape') return <ShapeLayer layer={layer} />;
  if (layer.type === 'image') {
    return (
      <div
        ref={(el) => {
          paintPhoto(el, layer.src, layer.focus);
          el?.style.setProperty('--rl-img-op', String(layer.opacity));
        }}
        className={cn('bgimg', `tone-${layer.tone}`)}
        data-depth={layer.depth}
      />
    );
  }
  return (
    <div
      ref={(el) => {
        if (el) el.style.opacity = String(layer.opacity);
      }}
      className="taped"
      data-depth={layer.depth}
    >
      <div
        ref={(el) => {
          paintPhoto(el, layer.src, layer.focus);
        }}
        className={cn('taped-ph', `tone-${layer.tone}`)}
      />
      <span className="tape" />
    </div>
  );
}

export interface HeaderBackgroundProps {
  slot?: Slot;
  /** Which header on the page this is, so two draw different stars. */
  n?: number;
  /** For a preview: draw these instead of the site's. */
  options?: LookOptions;
  kit?: Kit;
}

/**
 * Just the layers. Place it first inside a `.rl-motif-host`; `MotifHost`
 * below does that, and is what a page normally uses.
 */
export function HeaderBackground({ slot = 'hero', n = 0, options, kit }: HeaderBackgroundProps) {
  const site = useSite();
  const siteOptions = site.data?.look.options ?? DEFAULT_OPTIONS;
  const kits = useKit(site.data?.look.kits);
  const o = options ?? siteOptions;
  const k = kit ?? kits.kit;
  const host = useRef<HTMLDivElement>(null);
  const scene = buildScene({ header: o.header, kit: k, slot, n });

  // The fade, and how strong the lines and stars are, on the layer box itself.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    el.style.setProperty(
      '--rl-ov-mask',
      maskFor(o.header.fade.kind, o.header.fade.strength, false),
    );
    el.style.setProperty(
      '--rl-ov-mask-sm',
      maskFor(o.header.fade.kind, o.header.fade.strength, true),
    );
    el.style.setProperty('--rl-pat-op', String(o.header.pattern));
    el.hidden = scene.length === 0;
  });
  useParallax(host, o.motion === 'on', scene.length);

  return (
    <div ref={host} className="rl-ov" data-slot={slot} aria-hidden="true">
      {scene.map((layer) => (
        <LayerView key={layer.key} layer={layer} />
      ))}
    </div>
  );
}

/** A header host: a stacking context with the background behind its children. */
export function MotifHost({
  slot = 'hero',
  n = 0,
  options,
  kit,
  className,
  children,
}: HeaderBackgroundProps & { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rl-motif-host', className)}>
      <HeaderBackground
        slot={slot}
        n={n}
        {...(options ? { options } : {})}
        {...(kit ? { kit } : {})}
      />
      {children}
    </div>
  );
}

/**
 * Drift: each layer moves by its depth times how far the host is from the
 * top of the window, so layers with different depths slide past each other
 * as the page scrolls. None under reduced motion or when the owner chose Still.
 */
function useParallax(ref: React.RefObject<HTMLElement | null>, on: boolean, layers: number) {
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    const view = el?.ownerDocument.defaultView;
    if (!el || !host || !view) return;
    const reduced =
      typeof view.matchMedia === 'function' &&
      view.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const still = !on || reduced;
    const nodes = [...el.querySelectorAll<HTMLElement | SVGElement>('[data-depth]')];
    const place = () => {
      const top = host.getBoundingClientRect().top;
      for (const n of nodes) {
        const d = still ? 0 : Number(n.getAttribute('data-depth'));
        n.style.transform = d ? `translate3d(0,${(-top * d).toFixed(1)}px,0)` : '';
      }
    };
    place();
    if (still) return;
    let queued = false;
    const onScroll = () => {
      if (queued) return;
      queued = true;
      view.requestAnimationFrame(() => {
        queued = false;
        place();
      });
    };
    view.addEventListener('scroll', onScroll, { passive: true });
    view.addEventListener('resize', onScroll);
    return () => {
      view.removeEventListener('scroll', onScroll);
      view.removeEventListener('resize', onScroll);
    };
  }, [ref, on, layers]);
}
