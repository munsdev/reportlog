/**
 * /people/history: every role and access change, and every copy of the
 * archive taken off the server, newest first. What "Who granted what"
 * (/access/audit) shows, as a tab of People, beside the people it is about.
 */
import { listAudit } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../lib/api.ts';
import { Empty } from '@/mockup/Empty.tsx';
import { ErrorLine } from '@/mockup/ErrorLine.tsx';
import { Pager } from '@/mockup/Pager.tsx';
import { Tbl } from '@/mockup/Tbl.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { auditWhat } from '../identity/AuditPage.tsx';
import { StaffOnly } from '../identity/StaffOnly.tsx';
import { PeopleTabs } from './PeopleTabs.tsx';

const PER_PAGE = 25;
const when = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ');

export function HistoryPage() {
  return (
    <StaffOnly needs={['admin', 'access_manager']}>
      <History />
    </StaffOnly>
  );
}

function History() {
  const [page, setPage] = useState(1);
  const audit = useQuery({
    queryKey: ['identity', 'audit'],
    queryFn: ({ signal }) => call(listAudit, { signal }),
  });
  const entries = audit.data?.entries ?? [];
  const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  const shown = entries.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  return (
    <StaffPage
      title="People"
      lede="Every role and access change, and every copy of the archive taken off the server, newest first."
      tabs={<PeopleTabs />}
    >
      <ErrorLine error={audit.error} />
      {audit.isPending ? <p role="status">Reading the record…</p> : null}
      {audit.data && entries.length === 0 ? (
        <Empty title="Nothing recorded yet">
          The first role given, taken or changed will be listed here.
        </Empty>
      ) : null}
      {entries.length > 0 ? (
        <>
          <Tbl
            cols={['When', 'Who', 'What changed']}
            rows={shown.map((e, i) => ({
              key: `${e.created_at}-${String(i)}`,
              cells: [
                <time dateTime={e.created_at}>{when(e.created_at)} UTC</time>,
                e.actor_email,
                auditWhat(e),
              ],
            }))}
          />
          <Pager page={page} pages={pages} onPage={setPage} label="Pages of changes" />
        </>
      ) : null}
    </StaffPage>
  );
}
