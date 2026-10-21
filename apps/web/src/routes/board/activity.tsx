import { createFileRoute } from '@tanstack/react-router';
import { ActivityPage } from '../../features/board/Activity.tsx';

export const Route = createFileRoute('/board/activity')({
  component: ActivityPage,
});
