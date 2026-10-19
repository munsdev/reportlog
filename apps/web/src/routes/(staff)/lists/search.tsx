import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { ListSearch } from '../../../features/lists/ListSearch.tsx';

export const Route = createFileRoute('/(staff)/lists/search')({
  component: () => (
    <StaffOnly needs="admin">
      <ListSearch />
    </StaffOnly>
  ),
});
