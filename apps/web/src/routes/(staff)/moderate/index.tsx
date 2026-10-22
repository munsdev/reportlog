import { createFileRoute } from '@tanstack/react-router';
import { QueuePage } from '../../../features/moderation/Queue.tsx';
import { parseQueueSearch } from '../../../features/moderation/queries.ts';

export const Route = createFileRoute('/(staff)/moderate/')({
  validateSearch: parseQueueSearch,
  component: function Queue() {
    return <QueuePage search={Route.useSearch()} />;
  },
});
