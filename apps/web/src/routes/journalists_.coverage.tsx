import { createFileRoute } from '@tanstack/react-router';
import { MyCoveragePage } from '../features/articles/MyCoverage.tsx';

export const Route = createFileRoute('/journalists_/coverage')({
  component: MyCoveragePage,
});
