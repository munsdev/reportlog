import { createFileRoute } from '@tanstack/react-router';
import { JournalistLinks } from '../../features/journalists/BoardTabs.tsx';

export const Route = createFileRoute('/board/links')({
  component: JournalistLinks,
});
