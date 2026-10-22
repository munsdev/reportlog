/**
 * Who granted what (settings-and-admin.md §12): the role trail, newest
 * first, as a table with mono timestamps and pages of 25. It cannot be
 * edited, by anybody, which is the only reason it is worth reading.
 *
 * The server sends the most recent changes in one answer; the pages are cut
 * here, so moving between them asks for nothing more.
 */
import { listAudit } from '@reportlog/contracts';
import type { ResponseOf } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card } from '@/components/ui/card.tsx';
import { Empty } from '@/components/ui/empty.tsx';
import { Pagination } from '@/components/ui/pagination.tsx';
import { CountLine } from '@/components/ui/type.tsx';
import { call } from '../../lib/api.ts';
import { StaffPage } from '../nav/StaffPage.tsx';
import { useMe } from './session.ts';
import { SignInPrompt } from './SignInPrompt.tsx';
import { ErrorText } from './ui.tsx';

type AuditEntry = ResponseOf<typeof listAudit>['entries'][number];

const PER_PAGE = 25;

/** One change as a sentence: who did what to whom. */
export function auditSentence(e: AuditEntry): string {
  // A copy of the whole archive taken off the server (the owner's backups
  // and exports): nobody else is its subject.
  if (e.action === 'download') return `${e.actor_email} downloaded ${e.detail}`;
  const verb = e.action === 'grant' ? 'gave' : e.action === 'revoke' ? 'took from' : 'changed, for';
  return `${e.actor_email} ${verb} ${e.subject_email}: ${e.detail}${e.organization ? ` (${e.organization})` : ''}`;
}

const when = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ');

export function AuditPage() {
  const me = useMe();
  const [page, setPage] = useState(1);
  const audit = useQuery({
    queryKey: ['identity', 'audit'],
    queryFn: ({ signal }) => call(listAudit, { signal }),
    enabled: me.data?.signedIn === true,
  });
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next="/access/audit" />;
  const entries = audit.data?.entries ?? [];
  const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  const shown = entries.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  return (
    <StaffPage
      title="Who granted what"
      lede="Every change to who may do what, and every copy of the whole archive taken off the server, as it was made. Nothing here can be edited or removed."
    >
      <ErrorText error={audit.error} />
      {audit.isPending ? <p role="status">Reading the record…</p> : null}
      {audit.data && entries.length === 0 ? (
        <Empty title="Nothing recorded yet">
          The first role given, taken or changed will be listed here.
        </Empty>
      ) : null}
      {entries.length > 0 ? (
        <Card>
          <CountLine
            parts={[
              `${String(entries.length)} ${entries.length === 1 ? 'change' : 'changes'}`,
              'newest first',
              'times in UTC',
            ]}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Changes to who may do what, newest first</caption>
              <thead>
                <tr className="border-b border-ink-alt">
                  <th scope="col" className="py-2 pr-4 label-face text-xs">
                    When
                  </th>
                  <th scope="col" className="py-2 label-face text-xs">
                    What changed
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr
                    key={`${e.created_at}-${String(i)}`}
                    className="border-b border-line align-top last:border-0"
                  >
                    <td className="py-2 pr-4 font-mono whitespace-nowrap">
                      <time dateTime={e.created_at}>{when(e.created_at)}</time>
                    </td>
                    <td className="py-2 break-words">{auditSentence(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={pages} onPage={setPage} label="Pages of changes" />
        </Card>
      ) : null}
    </StaffPage>
  );
}
