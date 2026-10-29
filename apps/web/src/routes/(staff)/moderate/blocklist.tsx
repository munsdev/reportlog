import { createFileRoute } from '@tanstack/react-router';
import { BlocklistPage } from '../../../features/moderation/Blocklist.tsx';

export const Route = createFileRoute('/(staff)/moderate/blocklist')({
  component: BlocklistPage,
});
