import { createFileRoute } from '@tanstack/react-router';
import { FloodScreen } from '../../../features/flood/FloodScreen.tsx';

export const Route = createFileRoute('/(staff)/moderate/flood')({
  component: FloodScreen,
});
