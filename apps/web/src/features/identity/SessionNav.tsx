/**
 * The header's corner: "Sign in", or who you are and the way out.
 *
 * Not shown on a door: the one page in front of the password asks the
 * server for nothing it does not need, and a session check would be refused
 * there and put the password back.
 */
import { Link, useNavigate } from '@tanstack/react-router';
import { useGateMode } from './gate.tsx';
import { useMe, useSignOut } from './session.ts';

export function SessionNav() {
  const mode = useGateMode();
  if (mode === 'door') return null;
  return <SessionLinks />;
}

function SessionLinks() {
  const me = useMe();
  const out = useSignOut();
  const navigate = useNavigate();
  if (!me.data) return null;
  if (!me.data.signedIn) {
    return (
      <Link
        to="/access/sign-in"
        className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
      >
        Sign in
      </Link>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-4 overflow-x-auto whitespace-nowrap text-sm">
      <Link
        to="/mine"
        className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
      >
        My reports
      </Link>
      <Link
        to="/notifications"
        className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
      >
        Email updates
      </Link>
      <Link
        to="/access"
        className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
      >
        {/* The same page for everybody; the staff menu (features/staff-nav)
            is where "Access" is offered to the people who grant it. */}
        Your account
      </Link>
      <button
        type="button"
        className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
        onClick={() => {
          out.mutate(undefined, {
            onSuccess: () => void navigate({ to: '/' }),
          });
        }}
      >
        Sign out
      </button>
    </div>
  );
}
