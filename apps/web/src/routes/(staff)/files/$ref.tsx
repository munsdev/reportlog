import { createFileRoute } from '@tanstack/react-router';
import { ReportFilesPage } from '../../../features/files/staff/FilesQueue.tsx';
import { OnlyFor } from '../../../features/staff-nav/OnlyFor.tsx';

export const Route = createFileRoute('/(staff)/files/$ref')({
  component: Report,
});

function Report() {
  const { ref } = Route.useParams();
  return (
    <OnlyFor audience={['moderator', 'admin']} who="moderators and administrators">
      <ReportFilesPage key={ref} reference={ref} />
    </OnlyFor>
  );
}
