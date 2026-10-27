/**
 * THE TICKER: a thin strip under the header with a line of the operator's own
 * words (the Ticker slot on the Wording screen) and a link to follow the
 * site. Both come from settings and both ship empty, so a site with neither
 * has no strip at all, not an empty one.
 *
 * NEVER ON A FORM. A filing card or a list form is one question at a time
 * and nothing around it may change or compete, so the strip is left out
 * there, as the front page's floating button is (`socialFloatPageOf`). It is
 * also absent on a door, where `useSite` asks nothing.
 *
 * Its follow link is the first account that is switched on. On a phone only
 * that link stays; the words are for the room a desktop has.
 */
import { SOCIAL_RULES } from '@reportlog/contracts';
import { useLocation } from '@tanstack/react-router';
import { useSite } from '@/components/ui/site.tsx';
import { socialHandle } from '../follow/handle.ts';
import { useFollow } from '../follow/useFollow.ts';

const FORM_ROOTS = ['/file', '/list', '/submit'];

export function Ticker() {
  const { pathname } = useLocation();
  const text = useSite().data?.copy.ticker_text ?? '';
  const first = useFollow('ticker').links[0];
  const onForm = FORM_ROOTS.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  if (onForm || (!text && !first)) return null;
  const handle = first ? socialHandle(first.id, first.url) : null;
  return (
    <div
      aria-label="Today"
      data-ticker
      className="border-b border-line bg-paper-alt text-ink print:hidden"
    >
      <div className="mx-auto flex max-w-[76rem] flex-wrap items-center gap-x-6 gap-y-1 px-[max(1rem,env(safe-area-inset-left))] py-1.5 font-mono text-xs tracking-wide uppercase md:px-8">
        {text ? <span className="max-[639px]:hidden">{text}</span> : null}
        {first ? (
          <a
            href={first.url}
            rel="me noopener noreferrer"
            referrerPolicy="no-referrer"
            data-social={first.id}
            className="inline-flex min-h-11 items-center underline underline-offset-4 sm:ml-auto"
          >
            {handle ? `Follow ${handle}` : `Follow on ${SOCIAL_RULES[first.id].name}`}
          </a>
        ) : null}
      </div>
    </div>
  );
}
