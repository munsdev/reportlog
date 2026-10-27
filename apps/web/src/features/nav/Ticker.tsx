/**
 * THE TICKER (`.ticker`): a thin strip under the header with a few short
 * parts in the operator's own words (the Ticker slot on the Wording screen,
 * one part to a line) and a link to follow the site. Both come from settings
 * and both ship empty, so a site with neither has no strip at all, not an
 * empty one.
 *
 * The mock-up's strip is: a bold lead (a date), a plain part, parts that go
 * on a phone (`.more`), then the follow link. The first line is the bold
 * lead when there is more than one; a single line is a plain part.
 *
 * NEVER ON A FORM. A filing card or a list form is one question at a time
 * and nothing around it may change or compete, so the strip is left out
 * there (the mock-up hides it on `body.form` as well). It is also absent on
 * a door, where `useSite` asks nothing.
 *
 * Its follow link is the first account that is switched on.
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
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (onForm || (!lines.length && !first)) return null;
  const handle = first ? socialHandle(first.id, first.url) : null;
  const lead = lines.length > 1 ? lines[0] : undefined;
  const rest = lines.length > 1 ? lines.slice(1) : lines;
  return (
    <div className="ticker" aria-label="Today" data-ticker>
      <div className="wrap">
        {lead ? <b>{lead}</b> : null}
        {rest.map((l, i) => (
          <span key={i} {...(i > 0 ? { className: 'more' } : {})}>
            {l}
          </span>
        ))}
        {first ? (
          <a
            className="more tk-follow"
            href={first.url}
            rel="me noopener noreferrer"
            referrerPolicy="no-referrer"
            data-social={first.id}
          >
            {handle ? `Follow ${handle}` : `Follow on ${SOCIAL_RULES[first.id].name}`}
          </a>
        ) : null}
      </div>
    </div>
  );
}
