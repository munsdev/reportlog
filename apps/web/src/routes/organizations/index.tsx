import { createFileRoute } from '@tanstack/react-router';
import { DirectoryPage } from '../../features/site-pages/Directory.tsx';

export const Route = createFileRoute('/organizations/')({
  component: DirectoryPage,
});
