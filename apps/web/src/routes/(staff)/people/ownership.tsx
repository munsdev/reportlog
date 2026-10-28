import { createFileRoute } from '@tanstack/react-router';
import { OwnershipPage } from '../../../features/people/OwnershipPage.tsx';

export const Route = createFileRoute('/(staff)/people/ownership')({
  component: OwnershipPage,
});
