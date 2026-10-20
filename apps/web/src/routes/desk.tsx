import { createFileRoute } from '@tanstack/react-router';
import { DeskPage } from '../features/journalists/Desk.tsx';

export const Route = createFileRoute('/desk')({
  component: DeskPage,
});
