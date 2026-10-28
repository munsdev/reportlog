/**
 * /people/ownership: who owns this deployment, and the owner's hand-over.
 * The panel is the one the access page drew (AccessHome.tsx, OwnerSeat), on
 * a page of its own under People: Access Managers see who owns it, and only
 * the owner acts.
 */
import { StaffPage } from '../nav/StaffPage.tsx';
import { OwnerSeat } from '../identity/AccessHome.tsx';
import { useMe } from '../identity/session.ts';
import { StaffOnly } from '../identity/StaffOnly.tsx';

export function OwnershipPage() {
  return (
    <StaffOnly needs={['admin', 'access_manager']}>
      <Ownership />
    </StaffOnly>
  );
}

function Ownership() {
  const me = useMe();
  return (
    <StaffPage
      title="Ownership"
      lede="The owner is the one person who appoints administrators, and who can hand the deployment on."
    >
      {me.data?.signedIn ? <OwnerSeat me={me.data} /> : <p role="status">Loading…</p>}
    </StaffPage>
  );
}
