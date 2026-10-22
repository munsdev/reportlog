import { createFileRoute } from '@tanstack/react-router';
import { ItemPage } from '../../../features/moderation/Item.tsx';
import { parseQueueSearch } from '../../../features/moderation/queries.ts';

/**
 * One report under moderation. It takes the queue's filters too, so "Back to
 * the queue" and "Next waiting report" keep the queue as it was left.
 */
export const Route = createFileRoute('/(staff)/moderate/$threadId')({
  validateSearch: parseQueueSearch,
  component: function Item() {
    const { threadId } = Route.useParams();
    return <ItemPage key={threadId} threadId={threadId} search={Route.useSearch()} />;
  },
});
