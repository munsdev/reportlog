import { createFileRoute } from '@tanstack/react-router';
import { MyReportPage } from '../../features/form/MyReports.tsx';

export const Route = createFileRoute('/mine/$threadId')({
  component: MyReport,
});

function MyReport() {
  const { threadId } = Route.useParams();
  return <MyReportPage threadId={threadId} />;
}
