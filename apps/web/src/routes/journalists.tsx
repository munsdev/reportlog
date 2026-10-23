import { createFileRoute } from '@tanstack/react-router';
import { JournalistsLanding } from '../features/journalists/Landing.tsx';

export const Route = createFileRoute('/journalists')({
  component: JournalistsLanding,
});
