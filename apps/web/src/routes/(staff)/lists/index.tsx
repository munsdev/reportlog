import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { ListAdmin } from '../../../features/lists/ListAdmin.tsx';

export const Route = createFileRoute('/(staff)/lists/')({
  component: () => (
    <StaffOnly needs="admin">
      <ListAdmin />
    </StaffOnly>
  ),
});
