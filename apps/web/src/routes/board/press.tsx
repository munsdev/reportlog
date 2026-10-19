import { createFileRoute } from '@tanstack/react-router';
import { PressPage } from '../../features/board/Press.tsx';

export const Route = createFileRoute('/board/press')({
  component: PressPage,
});
