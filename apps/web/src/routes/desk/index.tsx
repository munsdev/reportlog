import { createFileRoute } from '@tanstack/react-router';
import { DeskDoor } from '../../features/journalists/Desk.tsx';

// A door, not a desk (decision 81): the role and the agreement, then the board.
export const Route = createFileRoute('/desk/')({
  component: DeskDoor,
});
