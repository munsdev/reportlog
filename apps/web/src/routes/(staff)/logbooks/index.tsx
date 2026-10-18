import { createFileRoute } from '@tanstack/react-router';
import { LogbookList } from '../../../features/builder/LogbookList.tsx';

// TODO(workstream A): staff only. Put this route behind requireRole('admin')
// (which the owner satisfies) in a beforeLoad, and say "sign in" otherwise.
export const Route = createFileRoute('/(staff)/logbooks/')({
  component: LogbookList,
});
