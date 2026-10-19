import { createFileRoute } from '@tanstack/react-router';
import { BoardMapsPage } from '../../features/board/Maps.tsx';

export const Route = createFileRoute('/board/maps')({
  component: BoardMapsPage,
});
