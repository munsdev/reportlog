import { createFileRoute } from '@tanstack/react-router';
import { LogbookList } from '../../../features/builder/LogbookList.tsx';

export const Route = createFileRoute('/(staff)/logbooks/')({
  component: LogbookList,
});
