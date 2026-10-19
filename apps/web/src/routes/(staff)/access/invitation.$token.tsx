import { createFileRoute } from '@tanstack/react-router';
import { InvitationPage } from '../../../features/identity/InvitationPage.tsx';

/** Reached only from the link in an invitation email. */
export const Route = createFileRoute('/(staff)/access/invitation/$token')({
  component: function Invitation() {
    const { token } = Route.useParams();
    return <InvitationPage token={token} />;
  },
});
