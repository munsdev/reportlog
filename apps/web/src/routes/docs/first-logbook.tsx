import { createFileRoute } from '@tanstack/react-router';
import { FirstLogbookGuide } from '../../features/site-pages/Guides.tsx';

export const Route = createFileRoute('/docs/first-logbook')({
  component: FirstLogbookGuide,
});
