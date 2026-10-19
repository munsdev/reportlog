import { Link, createFileRoute } from '@tanstack/react-router';
import { MyReportPage } from '../../features/form/MyReports.tsx';
import { useMe } from '../../features/identity/session.ts';

export const Route = createFileRoute('/mine/$threadId')({
  component: MyReport,
});

function MyReport() {
  const { threadId } = Route.useParams();
  const me = useMe();
  return (
    <>
      <MyReportPage threadId={threadId} />
      {/* Beside the page rather than in it: the page is in the form's folder,
          which the files workstream is changing. */}
      {me.data?.signedIn ? (
        <p className="mt-6">
          <Link to="/mine/declaration/$threadId" params={{ threadId }} className="underline">
            Print a signed declaration
          </Link>
        </p>
      ) : null}
    </>
  );
}
