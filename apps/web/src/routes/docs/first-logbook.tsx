import { Navigate, createFileRoute } from '@tanstack/react-router';

// The guides are for whoever runs the archive, not for visitors, so the
// public addresses send visitors to How to use this.
export const Route = createFileRoute('/docs/first-logbook')({
  component: () => <Navigate to="/how" replace />,
});
