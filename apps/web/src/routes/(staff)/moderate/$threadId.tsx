import { createFileRoute } from '@tanstack/react-router';
import { ItemPage } from '../../../features/moderation/Item.tsx';

export const Route = createFileRoute('/(staff)/moderate/$threadId')({
  component: function Item() {
    const { threadId } = Route.useParams();
    return <ItemPage threadId={threadId} />;
  },
});
