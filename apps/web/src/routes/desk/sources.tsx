import { createFileRoute } from '@tanstack/react-router';
import { DeskSourcesPage } from '../../features/journalists/Desk.tsx';

export const Route = createFileRoute('/desk/sources')({
  component: DeskSourcesPage,
});
