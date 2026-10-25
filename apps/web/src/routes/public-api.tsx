/**
 * The Public API page is now the "For developers" tab of How to use this.
 * The address stays, so links made before the move still work.
 */
import { Navigate, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/public-api')({
  component: () => <Navigate to="/how" search={{ tab: 'developers' }} replace />,
});
