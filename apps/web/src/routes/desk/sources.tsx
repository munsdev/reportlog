import { Navigate, createFileRoute } from '@tanstack/react-router';

// Gone with the desk (decision 81); an old bookmark or email still lands somewhere that works.
export const Route = createFileRoute('/desk/sources')({
  component: () => <Navigate to="/board" replace />,
});
