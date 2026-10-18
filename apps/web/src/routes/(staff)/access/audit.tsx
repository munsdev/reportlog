import { createFileRoute } from '@tanstack/react-router';
import { AuditPage } from '../../../features/identity/AuditPage.tsx';

export const Route = createFileRoute('/(staff)/access/audit')({
  component: AuditPage,
});
