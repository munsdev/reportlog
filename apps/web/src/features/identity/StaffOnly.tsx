/**
 * A staff screen's door: signed out sees the sign-in prompt, signed in
 * without the role sees a plain refusal, and only then the screen.
 *
 * This is courtesy, not security. The server refuses the same people on
 * every staff route regardless; this only saves them a screen of errors.
 * Somebody who holds the role and has not yet proved a second factor (plan
 * E, E3) is shown the way to it instead.
 * Rank comes from @reportlog/access, so `admin` admits the owner. Several
 * roles mean any of them: admin does not imply moderator, so a screen for
 * both names both.
 */
import { roleSatisfies } from '@reportlog/access';
import type { SystemRole } from '@reportlog/access';
import { useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SecondFactorGate, pendingSecondFactor } from './secondFactor.tsx';
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
  otherwise,
}: {
  needs: SystemRole | readonly SystemRole[];
  children: ReactNode;
  /** Shown to a signed-in account without the role, instead of the plain refusal. */
  otherwise?: ReactNode;
}) {
  const roles: readonly SystemRole[] = typeof needs === 'string' ? [needs] : needs;
  const me = useMe();
  const { pathname } = useLocation();
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next={pathname} />;
  // Holding the role, without the second factor yet: the way to it, not a refusal.
  const held = me.data.heldRoles;
  if (pendingSecondFactor(me.data) && roles.some((r) => roleSatisfies(held, r))) {
    return <SecondFactorGate>{null}</SecondFactorGate>;
  }
  const acting = me.data.roles;
  if (!roles.some((r) => roleSatisfies(acting, r))) {
    if (otherwise) return otherwise;
    return (
      <section className="form-stack">
        <h1 className="h-page">Not for this account</h1>
        <p>
          Only {roles.map((r) => WHO[r] ?? r).join(' or ')} can open this page. Ask one if you need
          to.
        </p>
      </section>
    );
  }
  return <SecondFactorGate>{children}</SecondFactorGate>;
}
