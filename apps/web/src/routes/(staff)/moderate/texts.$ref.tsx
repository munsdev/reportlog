import { createFileRoute } from '@tanstack/react-router';
import { WrittenByRef } from '../../../features/moderation/Forward.tsx';

/** A written account's note is written on its report's page now (Forward.tsx). */
export const Route = createFileRoute('/(staff)/moderate/texts/$ref')({
  component: function Written() {
    const { ref } = Route.useParams();
    return <WrittenByRef key={ref} textRef={ref} />;
  },
});
