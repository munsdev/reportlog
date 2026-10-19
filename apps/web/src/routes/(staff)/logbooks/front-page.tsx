import { createFileRoute } from '@tanstack/react-router';
import { HomeButtonsEditor } from '../../../features/builder/HomeButtonsEditor.tsx';

// TODO(workstream A): staff only. Put this route behind requireRole('admin')
// (which the owner satisfies) in a beforeLoad, and say "sign in" otherwise.
export const Route = createFileRoute('/(staff)/logbooks/front-page')({
  component: HomeButtonsEditor,
});
