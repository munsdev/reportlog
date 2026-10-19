import { createFileRoute } from '@tanstack/react-router';
import { RosterPage } from '../../../features/identity/Roster.tsx';

export const Route = createFileRoute('/(staff)/access/roster')({
  component: RosterPage,
});
