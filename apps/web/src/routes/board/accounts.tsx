import { createFileRoute } from '@tanstack/react-router';
import { JournalistAccounts } from '../../features/journalists/BoardTabs.tsx';

export const Route = createFileRoute('/board/accounts')({
  component: JournalistAccounts,
});
