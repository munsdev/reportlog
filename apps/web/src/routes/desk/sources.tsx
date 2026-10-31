import { createFileRoute, redirect } from '@tanstack/react-router';

// Gone with the desk (decision 81); an old bookmark or email still lands somewhere that works.
export const Route = createFileRoute('/desk/sources')({
  beforeLoad: () => {
    throw redirect({ to: '/board', replace: true });
  },
});
