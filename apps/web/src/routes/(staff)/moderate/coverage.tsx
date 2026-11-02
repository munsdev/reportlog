import { createFileRoute } from '@tanstack/react-router';
import { CoverageQueue } from '../../../features/articles/CoverageQueue.tsx';

export const Route = createFileRoute('/(staff)/moderate/coverage')({
  component: CoverageQueue,
});
