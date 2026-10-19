import { createFileRoute } from '@tanstack/react-router';
import { TransparencyLogPage } from '../../features/anchor/TransparencyLog.tsx';
import { StaffOnly } from '../../features/identity/StaffOnly.tsx';

export const Route = createFileRoute('/(staff)/transparency-log')({
  component: () => (
    <StaffOnly needs="admin">
      <TransparencyLogPage />
    </StaffOnly>
  ),
});
