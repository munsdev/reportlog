import { createFileRoute } from '@tanstack/react-router';
import { LinkChecksPage } from '../../../features/lists/LinkChecks.tsx';
import { ReviewersOnly } from '../../../features/lists/ListAdmin.tsx';

export const Route = createFileRoute('/(staff)/lists/links')({
  component: () => (
    <ReviewersOnly>
      <LinkChecksPage />
    </ReviewersOnly>
  ),
});
