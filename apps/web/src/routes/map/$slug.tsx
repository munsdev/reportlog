import { Navigate, createFileRoute } from '@tanstack/react-router';

// The old public address, /map/<slug>. Links already shared keep working.
export const Route = createFileRoute('/map/$slug')({
  validateSearch: (search: Record<string, unknown>) => search,
  component: function OldMapRoute() {
    const { slug } = Route.useParams();
    const search = Route.useSearch();
    return <Navigate to="/maps/$slug" params={{ slug }} search={search} replace />;
  },
});
