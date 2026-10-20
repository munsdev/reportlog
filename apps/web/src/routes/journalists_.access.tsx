import { createFileRoute } from '@tanstack/react-router';
import { AskAccessPage } from '../features/journalists/AccessPages.tsx';

export const Route = createFileRoute('/journalists_/access')({
  component: AskAccessPage,
});
