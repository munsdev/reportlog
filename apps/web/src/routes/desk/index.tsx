import { createFileRoute } from '@tanstack/react-router';
import { DeskLinksPage } from '../../features/journalists/Desk.tsx';

export const Route = createFileRoute('/desk/')({
  component: DeskLinksPage,
});
