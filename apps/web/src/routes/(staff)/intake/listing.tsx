import { createFileRoute } from '@tanstack/react-router';
import { OrganizationJump } from '../../../features/intake/OrganizationJump.tsx';

export const Route = createFileRoute('/(staff)/intake/listing')({
  component: () => <OrganizationJump where="listing" />,
});
