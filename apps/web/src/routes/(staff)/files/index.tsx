import { createFileRoute } from '@tanstack/react-router';
import { FilesQueue } from '../../../features/files/staff/FilesQueue.tsx';
import { OnlyFor } from '../../../features/staff-nav/OnlyFor.tsx';

export const Route = createFileRoute('/(staff)/files/')({
  component: () => (
    <OnlyFor audience={['moderator']} who="moderators">
      <FilesQueue />
    </OnlyFor>
  ),
});
