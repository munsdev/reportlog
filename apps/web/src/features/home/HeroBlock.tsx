/**
 * The headline block, in the mock-up's three layouts:
 *
 *   poster  `.hero.motif-host`: eyebrow, the big `.display` headline with its
 *           second line in `.two`, the slogan bar, the lede, the buttons and
 *           a credit line, over the header background;
 *   action  a `.h-band` headline, a lede and the buttons;
 *   info    a plain page headline, a longer introduction and quieter buttons.
 *
 * The buttons are the operator's arrangement of the front page's buttons
 * (Site, Front-page buttons): the first is the accent, the rest are quiet.
 *
 * THE FITTED HEADLINES ARE WRITTEN AS MARKUP, ESCAPED. The page script
 * (public/mockup/site.js) rebuilds a `.display` or `.h-band` heading's
 * children to fit it to its box; React must not be holding children there
 * that the script then takes apart. So the heading is set once from an
 * escaped string, and a new string makes a new element (the key).
 */
import { blockText } from '@reportlog/contracts';
import type { Block, HomeButton } from '@reportlog/contracts';
import { cn } from '@/lib/utils.ts';
import { hrefOf } from './buttons.tsx';
import { Markdown } from '../pages/Markdown.tsx';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** The headline's two lines as the mock-up writes them. */
export function headlineHtml(first: string, second: string): string {
  return second ? `${esc(first)}<br><span class="two">${esc(second)}</span>` : esc(first);
}

function Buttons({ buttons, quiet }: { buttons: readonly HomeButton[]; quiet: boolean }) {
  const drawn = buttons.flatMap((b) => {
    if (b.kind === 'social') return [];
    const href = hrefOf(b);
    return href ? [{ b, href }] : [];
  });
  if (!drawn.length) return null;
  return (
    <div className="btn-row">
      {drawn.map(({ b, href }, i) => (
        <a
          key={`${b.kind}:${b.ref}`}
          className={cn(
            quiet ? 'btn sm flat' : `btn ${i === 0 ? 'go' : 'ghost'} lg`,
            b.blurb && 'two-line',
          )}
          href={href}
        >
          {b.label}
          {/* The second line: the operator's Subtext, else the target's own blurb. */}
          {b.blurb ? <span className="sub">{b.blurb}</span> : null}
        </a>
      ))}
    </div>
  );
}

export function HeroBlock({ block, buttons }: { block: Block; buttons: readonly HomeButton[] }) {
  const f = (k: string) => blockText(block, k);
  const variant = block.variant ?? 'poster';
  const eyebrow = f('eyebrow');
  const first = f('headline');
  const second = f('headline2');
  const who = f('who');
  const eyebrowEl = eyebrow ? <span className="eyebrow">{eyebrow}</span> : null;

  if (variant === 'info') {
    return (
      <section className="hero" aria-labelledby="h1">
        <div className="wrap">
          {eyebrowEl}
          <h1 className="h-page" id="h1">
            {[first, second].filter(Boolean).join(' ')}
          </h1>
          <Markdown text={f('body')} />
          <Buttons buttons={buttons} quiet />
        </div>
      </section>
    );
  }
  if (variant === 'action') {
    const html = headlineHtml([first, second].filter(Boolean).join(' '), '');
    return (
      <section className="hero" aria-labelledby="h1">
        <div className="wrap">
          {eyebrowEl}
          <h1 className="h-band" id="h1" key={html} dangerouslySetInnerHTML={{ __html: html }} />
          {f('line') ? <p className="lede">{f('line')}</p> : null}
          <Buttons buttons={buttons} quiet={false} />
        </div>
      </section>
    );
  }
  const html = headlineHtml(first, second);
  return (
    <section className="hero motif-host" aria-labelledby="h1">
      <div className="ov" data-slot="hero"></div>
      <div className="wrap">
        {eyebrowEl}
        <h1 className="display" id="h1" key={html} dangerouslySetInnerHTML={{ __html: html }} />
        {f('slogan') ? <p className="tagline">{f('slogan')}</p> : null}
        {f('line') ? <p className="lede">{f('line')}</p> : null}
        <Buttons buttons={buttons} quiet={false} />
        {who ? <p className="who">{who}</p> : null}
      </div>
    </section>
  );
}
