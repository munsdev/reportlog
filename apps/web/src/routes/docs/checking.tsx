import { Navigate, createFileRoute } from '@tanstack/react-router';

// The checking guide is now a tab of How to use this; old links still land.
export const Route = createFileRoute('/docs/checking')({
  component: () => <Navigate to="/how" search={{ tab: 'record' }} replace />,
});
