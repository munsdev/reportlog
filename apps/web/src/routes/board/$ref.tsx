import { createFileRoute } from '@tanstack/react-router';
import { BoardReportPage } from '../../features/board/BoardReport.tsx';

export const Route = createFileRoute('/board/$ref')({
  component: function BoardReport() {
    const { ref } = Route.useParams();
    return <BoardReportPage publicRef={ref} />;
  },
});
