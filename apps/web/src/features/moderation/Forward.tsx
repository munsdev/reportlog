/**
 * Old addresses that named one item, sent on to its page now
 * (docs/design/moderation-unified.md): a report's files and a written
 * account's note are decided on the report's page, a tip's on its list's.
 * They look the item up first, because the old address named it by
 * reference, not by the thread the new one takes.
 */
import { getText } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from '@tanstack/react-router';
import { Problem } from '../../mockup/Notice.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { fileQueueQuery } from '../files/staff/queries.ts';

/** `/files/$ref`: the report a reference names, any version of it. */
export function ReportByReference({ reference }: { reference: string }) {
  const query = useQuery(fileQueueQuery(reference));
  const report = query.data?.reports[0];
  if (report) {
    return <Navigate to="/moderate/$threadId" params={{ threadId: report.thread_id }} replace />;
  }
  return (
    <StaffPage title="A report" mono>
      {query.isPending ? <p role="status">Finding the report…</p> : null}
      {query.isError ? <Problem>{query.error.message}</Problem> : null}
      {query.data ? <Problem>There is no report with the reference {reference}.</Problem> : null}
    </StaffPage>
  );
}

/** `/moderate/texts/$ref`: the page holding a written account. */
export function WrittenByRef({ textRef }: { textRef: string }) {
  const query = useQuery({
    queryKey: ['texts', 'one', textRef],
    queryFn: ({ signal }) => call(getText, { params: { ref: textRef }, signal }),
  });
  const item = query.data?.item;
  if (item?.thread_id) {
    return <Navigate to="/moderate/$threadId" params={{ threadId: item.thread_id }} replace />;
  }
  if (item) return <Navigate to="/lists/review" replace />;
  return (
    <StaffPage title="A written account">
      {query.isPending ? <p role="status">Finding it…</p> : null}
      {query.isError ? <Problem>{query.error.message}</Problem> : null}
    </StaffPage>
  );
}
