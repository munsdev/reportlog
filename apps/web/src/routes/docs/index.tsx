import { createFileRoute } from '@tanstack/react-router';
import { GuidesIndex } from '../../features/site-pages/Guides.tsx';

export const Route = createFileRoute('/docs/')({
  component: GuidesIndex,
});
