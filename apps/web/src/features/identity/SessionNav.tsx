/**
 * The header's corner: "Sign in", or who you are and the way out.
 *
 * Not shown on a door: the one page in front of the password asks the
 * server for nothing it does not need, and a session check would be refused
 * there and put the password back.
 */
import { roleSatisfies } from '@reportlog/access';
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
      <Link to="/access/sign-in" className="underline-offset-4 hover:underline">
        Sign in
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-4 text-sm">
      <Link to="/mine" className="underline-offset-4 hover:underline">
        My reports
      </Link>
      {roleSatisfies(me.data.role, 'moderator') || roleSatisfies(me.data.role, 'admin') ? (
        <Link to="/moderate" className="underline-offset-4 hover:underline">
          Moderate
        </Link>
      ) : null}
      <Link to="/access" className="underline-offset-4 hover:underline">
        {me.data.grantsAccess ? 'Access' : 'Your account'}
      </Link>
      <button
        type="button"
        className="underline-offset-4 hover:underline"
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
