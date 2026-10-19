import { createFileRoute, notFound } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { ListEditor } from '../../../features/lists/ListEditor.tsx';

export const Route = createFileRoute('/(staff)/lists/$id')({
  params: {
    parse: ({ id }) => {
      const n = Number(id);
      // The router's own not-found signal, which it expects to be thrown.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      if (!Number.isInteger(n) || n < 1) throw notFound();
      return { id: n };
    },
    stringify: ({ id }) => ({ id: String(id) }),
  },
  component: ListRoute,
});

function ListRoute() {
  const { id } = Route.useParams();
  return (
    <StaffOnly needs="admin">
      <ListEditor id={id} />
    </StaffOnly>
  );
}
