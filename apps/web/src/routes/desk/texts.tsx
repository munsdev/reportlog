import { createFileRoute } from '@tanstack/react-router';
import { DeskTextsPage } from '../../features/journalists/Desk.tsx';

export const Route = createFileRoute('/desk/texts')({
  component: DeskTextsPage,
});
