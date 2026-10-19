import { createFileRoute, notFound } from '@tanstack/react-router';
import { LogbookEditor } from '../../../features/builder/LogbookEditor.tsx';

// TODO(workstream A): staff only. Put this route behind requireRole('admin')
// (which the owner satisfies) in a beforeLoad, and say "sign in" otherwise.
export const Route = createFileRoute('/(staff)/logbooks/$id')({
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
  component: EditorPage,
});

function EditorPage() {
  const { id } = Route.useParams();
  return <LogbookEditor id={id} />;
}
