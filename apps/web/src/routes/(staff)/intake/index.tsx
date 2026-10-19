import { createFileRoute } from '@tanstack/react-router';
import { IntakeHome } from '../../../features/intake/IntakeHome.tsx';

export const Route = createFileRoute('/(staff)/intake/')({
  component: IntakeHome,
});
