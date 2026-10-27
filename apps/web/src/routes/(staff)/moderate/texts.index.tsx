import { createFileRoute } from '@tanstack/react-router';
import { TextsPage } from '../../../features/moderation/Texts.tsx';

export const Route = createFileRoute('/(staff)/moderate/texts/')({
  component: TextsPage,
});
