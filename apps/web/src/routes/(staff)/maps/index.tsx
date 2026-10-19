import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { MapAdmin } from '../../../features/maps/MapAdmin.tsx';

export const Route = createFileRoute('/(staff)/maps/')({
  component: () => (
    <StaffOnly needs="admin">
      <MapAdmin />
    </StaffOnly>
  ),
});
