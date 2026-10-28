import { createFileRoute } from '@tanstack/react-router';
import { HistoryPage } from '../../../features/people/HistoryPage.tsx';

export const Route = createFileRoute('/(staff)/people/history')({
  component: HistoryPage,
});
