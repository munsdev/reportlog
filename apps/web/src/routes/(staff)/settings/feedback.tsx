import { createFileRoute } from '@tanstack/react-router';
import { FeedbackQueue } from '../../../features/feedback/FeedbackQueue.tsx';

// Administrators only, like every settings screen (the layout says so).
export const Route = createFileRoute('/(staff)/settings/feedback')({
  component: FeedbackQueue,
});
