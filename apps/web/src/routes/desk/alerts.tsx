import { createFileRoute } from '@tanstack/react-router';
import { DeskAlertsPage } from '../../features/journalists/Desk.tsx';

export const Route = createFileRoute('/desk/alerts')({
  component: DeskAlertsPage,
});
