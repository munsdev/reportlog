/**
 * /account: your own account, the same page for everybody (menu.ts). It was
 * the top of /access, which for those who grant access was also People and
 * roles, the owner's seat and the site password, under three names. Those
 * are under People and Site settings now; this page has nothing on it about
 * anybody else.
 */
import { Link } from '@tanstack/react-router';
import { Panel } from '@/mockup/Panel.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { OwnerSeat, YourAccount } from '../identity/AccessHome.tsx';
import { DeleteAccount } from '../identity/DeleteAccount.tsx';
import { useMe } from '../identity/session.ts';
import { SecondFactorGate } from '../identity/secondFactor.tsx';
import { SignInPrompt } from '../identity/SignInPrompt.tsx';

export function AccountPage() {
  const me = useMe();
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next="/account" />;
  const user = me.data;
  return (
    <SecondFactorGate>
      <StaffPage
        title="Your account"
        area="Account"
        lede="Your address, your roles, and how you sign in."
      >
        <YourAccount me={user} />
        {user.heldRoles.length > 0 ? (
          <Panel title="Signing in">
            <p>
              {user.secondFactor === 'optional'
                ? 'A second factor is optional for you, and we encourage it.'
                : 'Your role asks for a second factor each time you sign in.'}{' '}
              Your authenticator app, passkeys and recovery codes are on{' '}
              <Link to="/access/security">Signing in</Link>.
            </p>
          </Panel>
        ) : null}
        {/* Only an offer waiting for this person: the seat itself is under People. */}
        <OwnerSeat me={user} offerOnly />
        <DeleteAccount me={user} />
      </StaffPage>
    </SecondFactorGate>
  );
}
