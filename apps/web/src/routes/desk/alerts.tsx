import { createFileRoute, redirect } from '@tanstack/react-router';

// Gone with the desk (decision 81); an old bookmark or email still lands somewhere that works.
export const Route = createFileRoute('/desk/alerts')({
  beforeLoad: () => {
    throw redirect({ to: '/journalists/alerts', replace: true });
  },
});
