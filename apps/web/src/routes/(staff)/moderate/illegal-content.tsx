import { createFileRoute } from '@tanstack/react-router';
import { ContentNoticesPage } from '../../../features/platform/ContentNotices.tsx';

export const Route = createFileRoute('/(staff)/moderate/illegal-content')({
  component: ContentNoticesPage,
});
