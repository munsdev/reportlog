import { createFileRoute } from '@tanstack/react-router';
import { AccessHome } from '../../../features/identity/AccessHome.tsx';

export const Route = createFileRoute('/(staff)/access/')({
  component: AccessHome,
});
