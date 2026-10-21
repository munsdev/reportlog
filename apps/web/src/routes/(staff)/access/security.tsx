import { createFileRoute } from '@tanstack/react-router';
import { SecurityPage } from '../../../features/identity/SecurityPage.tsx';

// Anybody signed in may open it; it says so if their account needs no second factor.
export const Route = createFileRoute('/(staff)/access/security')({
  component: SecurityPage,
});
