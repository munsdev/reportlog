import { createFileRoute } from '@tanstack/react-router';
import { PeoplePage } from '../../../features/people/PeoplePage.tsx';

export const Route = createFileRoute('/(staff)/people/')({
  component: PeoplePage,
});
