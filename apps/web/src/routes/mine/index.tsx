import { createFileRoute } from '@tanstack/react-router';
import { MyReportsPage } from '../../features/form/MyReports.tsx';

export const Route = createFileRoute('/mine/')({
  component: MyReportsPage,
});
