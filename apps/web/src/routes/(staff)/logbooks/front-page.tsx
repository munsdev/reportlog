import { createFileRoute } from '@tanstack/react-router';
import { HomeButtonsEditor } from '../../../features/builder/HomeButtonsEditor.tsx';

export const Route = createFileRoute('/(staff)/logbooks/front-page')({
  component: HomeButtonsEditor,
});
