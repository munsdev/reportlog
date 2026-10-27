import { createFileRoute } from '@tanstack/react-router';
import { RedactPage } from '../../../features/moderation/Texts.tsx';

export const Route = createFileRoute('/(staff)/moderate/texts/$ref')({
  component: function Redact() {
    const { ref } = Route.useParams();
    return <RedactPage key={ref} textRef={ref} />;
  },
});
