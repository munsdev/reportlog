import { createFileRoute } from '@tanstack/react-router';
import { CheckingGuide } from '../../features/site-pages/Guides.tsx';

export const Route = createFileRoute('/docs/checking')({
  component: CheckingGuide,
});
