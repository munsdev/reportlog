import { createFileRoute } from '@tanstack/react-router';
import { ReviewersOnly } from '../../../features/lists/ListAdmin.tsx';
import { ReviewQueues } from '../../../features/lists/ListReview.tsx';

export const Route = createFileRoute('/(staff)/lists/review/')({
  component: () => (
    <ReviewersOnly>
      <ReviewQueues />
    </ReviewersOnly>
  ),
});
