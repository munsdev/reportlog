import { createFileRoute, notFound } from '@tanstack/react-router';
import { ReviewersOnly } from '../../../features/lists/ListAdmin.tsx';
import { ReviewPage } from '../../../features/lists/ListReview.tsx';

export const Route = createFileRoute('/(staff)/lists/review/$id')({
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
  component: ReviewRoute,
});

function ReviewRoute() {
  const { id } = Route.useParams();
  return (
    <ReviewersOnly>
      <ReviewPage id={id} />
    </ReviewersOnly>
  );
}
