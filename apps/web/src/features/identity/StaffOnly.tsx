/**
 * A staff screen's door: signed out sees the sign-in prompt, signed in
 * without the role sees a plain refusal, and only then the screen.
 *
 * This is courtesy, not security. The server refuses the same people on
 * every staff route regardless; this only saves them a screen of errors.
 * Rank comes from @reportlog/access, so `admin` admits the owner.
 *
 * `needs` is a system role, or `{ organization: [...] }` for a screen that
 * belongs to organization roles (coordinator intake): those come from the
 * signed-in person's memberships, and no system role stands in for them, as
 * on the server (`coordinatorOrgs` in apps/api/src/filing/intake.ts).
 */
import { roleSatisfies } from '@reportlog/access';
import type { SystemRole } from '@reportlog/access';
import type { OrgRoleName } from '@reportlog/contracts';
import { useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useMe } from './session.ts';
import { SignInPrompt } from './SignInPrompt.tsx';

export type StaffNeed = SystemRole | { organization: readonly OrgRoleName[] };

export function StaffOnly({ needs, children }: { needs: StaffNeed; children: ReactNode }) {
  const me = useMe();
  const { pathname } = useLocation();
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next={pathname} />;
  const admitted =
    typeof needs === 'string'
      ? roleSatisfies(me.data.role, needs)
      : me.data.memberships.some((m) => needs.organization.includes(m.role));
  if (!admitted) {
    return (
      <section className="space-y-3">
        <h1 className="font-display text-2xl font-bold">Not for this account</h1>
        <p>
          {typeof needs === 'string'
            ? 'Only an administrator can open this page. Ask one if you need to.'
            : 'Only a coordinator or manager of an organization can open this page. Ask your organization’s manager if you need to.'}
        </p>
      </section>
    );
  }
  return <>{children}</>;
}
