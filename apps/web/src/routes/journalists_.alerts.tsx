import { createFileRoute } from '@tanstack/react-router';
import { SignupPage } from '../features/journalists/SignupPage.tsx';

export const Route = createFileRoute('/journalists_/alerts')({
  component: SignupPage,
});
