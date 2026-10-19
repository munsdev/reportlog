import { createFileRoute } from '@tanstack/react-router';
import { NotificationsPage } from '../features/site-pages/NotificationsPage.tsx';

export const Route = createFileRoute('/notifications')({
  component: NotificationsPage,
});
