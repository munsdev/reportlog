/**
 * A staff screen's door: signed out sees the sign-in prompt, signed in
 * without the role sees a plain refusal, and only then the screen.
 *
 * This is courtesy, not security. The server refuses the same people on
 * every staff route regardless; this only saves them a screen of errors.
 * Rank comes from @reportlog/access, so `admin` admits the owner.
 */
import { roleSatisfies } from '@reportlog/access';
import type { SystemRole } from '@reportlog/access';
import { useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useMe } from './session.ts';
import { SignInPrompt } from './SignInPrompt.tsx';

export function StaffOnly({ needs, children }: { needs: SystemRole; children: ReactNode }) {
  const me = useMe();
  const { pathname } = useLocation();
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next={pathname} />;
  if (!roleSatisfies(me.data.role, needs)) {
    return (
      <section className="space-y-3">
        <h1 className="font-display text-2xl font-bold">Not for this account</h1>
        <p>Only an administrator can open this page. Ask one if you need to.</p>
      </section>
    );
  }
  return <>{children}</>;
}
