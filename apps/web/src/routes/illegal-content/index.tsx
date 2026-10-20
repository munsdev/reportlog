import { createFileRoute } from '@tanstack/react-router';
import { IllegalContentPage } from '../../features/platform/IllegalContent.tsx';

export const Route = createFileRoute('/illegal-content/')({
  component: IllegalContentPage,
});
