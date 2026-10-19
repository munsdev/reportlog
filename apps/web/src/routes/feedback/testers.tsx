import { createFileRoute } from '@tanstack/react-router';
import { Testers } from '../../features/feedback/Testers.tsx';
import { OnlyFor } from '../../features/staff-nav/OnlyFor.tsx';

export const Route = createFileRoute('/feedback/testers')({
  component: () => (
    <OnlyFor audience={['admin', 'access_manager']} who="administrators and Access Managers">
      <Testers />
    </OnlyFor>
  ),
});
