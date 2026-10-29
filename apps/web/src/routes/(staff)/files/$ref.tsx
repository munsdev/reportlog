import { createFileRoute } from '@tanstack/react-router';
import { ReportByReference } from '../../../features/moderation/Forward.tsx';
import { OnlyFor } from '../../../features/staff-nav/OnlyFor.tsx';

/** A report's files are decided on its page now, beside the rest of it (Forward.tsx). */
export const Route = createFileRoute('/(staff)/files/$ref')({
  component: Report,
});

function Report() {
  const { ref } = Route.useParams();
  return (
    <OnlyFor audience={['moderator', 'admin']} who="moderators and administrators">
      <ReportByReference key={ref} reference={ref} />
    </OnlyFor>
  );
}
