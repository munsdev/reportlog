import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { LogbookLimitsPage } from '../../../features/files/staff/FileAdmin.tsx';

export const Route = createFileRoute('/(staff)/files/logbooks/$id')({
  component: Logbook,
});

function Logbook() {
  const { id } = Route.useParams();
  return (
    <StaffOnly needs="admin">
      <LogbookLimitsPage key={id} id={Number(id)} />
    </StaffOnly>
  );
}
