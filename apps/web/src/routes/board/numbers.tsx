import { createFileRoute } from '@tanstack/react-router';
import { NumbersPage } from '../../features/board/Numbers.tsx';

export const Route = createFileRoute('/board/numbers')({
  component: NumbersPage,
});
