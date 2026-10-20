/**
 * A staff screen's door: signed out sees the sign-in prompt, signed in
 * without the role sees a plain refusal, and only then the screen.
 *
 * This is courtesy, not security. The server refuses the same people on
 * every staff route regardless; this only saves them a screen of errors.
 * Rank comes from @reportlog/access, so `admin` admits the owner. Several
 * roles mean any of them: admin does not imply moderator, so a screen for
 * both names both.
 */
import { roleSatisfies } from '@reportlog/access';
import type { SystemRole } from '@reportlog/access';
import { useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useMe } from './session.ts';
import { SignInPrompt } from './SignInPrompt.tsx';

const WHO: Partial<Record<SystemRole, string>> = {
  owner: 'the owner',
  admin: 'an administrator',
  moderator: 'a moderator',
  access_manager: 'an access manager',
  journalist: 'a vetted journalist',
};

export function StaffOnly({
  needs,
  children,
}: {
  needs: SystemRole | readonly SystemRole[];
  children: ReactNode;
}) {
  const roles: readonly SystemRole[] = typeof needs === 'string' ? [needs] : needs;
  const me = useMe();
  const { pathname } = useLocation();
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next={pathname} />;
  const role = me.data.role;
  if (!roles.some((r) => roleSatisfies(role, r))) {
    return (
      <section className="space-y-3">
        <h1 className="font-display text-2xl font-bold">Not for this account</h1>
        <p>
          Only {roles.map((r) => WHO[r] ?? r).join(' or ')} can open this page. Ask one if you need
          to.
        </p>
      </section>
    );
  }
  return <>{children}</>;
}
