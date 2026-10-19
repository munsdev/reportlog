/**
 * The staff menu: one bar under the header, showing a signed-in person the
 * staff screens they may open (`entries.ts`). Somebody with none sees no bar.
 *
 * NOT ON A DOOR. A door page may call only the filing calls, and asking who
 * is signed in would be refused there and put the password back. So on a
 * door this renders nothing and asks nothing: the check is made before the
 * part that queries is even mounted.
 */
import { Link, useMatches } from '@tanstack/react-router';
import { useGateMode } from '../identity/gate.tsx';
import { useMe } from '../identity/session.ts';
import { entriesFor } from './entries.ts';

export function StaffNav() {
  if (useGateMode() === 'door') return null;
  return <StaffLinks />;
}

function StaffLinks() {
  const me = useMe();
  // Which screen this is, as the router names it: feedback filed from here
  // says where it came from without carrying the address, which can hold a
  // token (an invitation's, say).
  const here = useMatches().at(-1)?.routeId;
  if (!me.data?.signedIn) return null;
  const entries = entriesFor(me.data);
  if (!entries.length) return null;
  return (
    <nav aria-label="Staff" className="border-b border-line bg-paper-alt">
      <ul className="mx-auto flex max-w-page flex-wrap gap-x-5 gap-y-1 px-4 py-2 text-sm font-semibold">
        {entries.map((e) => (
          <li key={e.to}>
            <Link
              to={e.to}
              {...(e.to === '/feedback' && here ? { search: { from: here } } : {})}
              activeOptions={{ exact: true, includeSearch: false }}
              className="underline-offset-4 hover:underline aria-[current=page]:underline"
            >
              {e.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
