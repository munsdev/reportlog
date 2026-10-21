import { createFileRoute } from '@tanstack/react-router';
import { IntakeLinksPage } from '../../../features/flood/IntakeLinks.tsx';

export const Route = createFileRoute('/(staff)/intake/links')({
  component: IntakeLinksPage,
});
