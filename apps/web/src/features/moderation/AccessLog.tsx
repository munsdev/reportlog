/**
 * Who opened protected data (settings-and-admin.md §13), under Records:
 * every opening of a reporter's contact details or of a file's original,
 * with who, when, which report and the reason as it was written. Newest
 * first. Read only.
 *
 * NO FILTER CAN HIDE A ROW. The page asks for the longest span the server
 * answers (120 months), and pages through it; it offers nothing to narrow
 * it. Reading the log is itself recorded, so opening this page is a look of
 * its own: the lede says so before the table, and the server does not list
 * those looks back here.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Card } from '../../components/ui/card.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { Pagination } from '../../components/ui/pagination.tsx';
import { CountLine } from '../../components/ui/type.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { accessLogQuery } from './queries.ts';
import { ScrollX } from '@/components/ui/scroll-x.tsx';

/** The longest span the access-log call answers for. */
const EVERYTHING = 120;
const PER_PAGE = 50;

export const LOOKED: Record<string, string> = {
  contact: 'Opened the contact details',
  contact_used: 'Had the address opened, to ask for files',
  file_original: 'Opened a file’s original',
  file_preview: 'Looked at a file’s cleaned copy',
  chain_file: 'Downloaded the complete chain file',
  desk_link: 'Read a checked link on the journalist desk',
  desk_report: 'Read the Sources on the journalist desk',
};

const when = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function AccessLogPage() {
  const query = useQuery(accessLogQuery(EVERYTHING));
  const [page, setPage] = useState(1);
  // A read of the log itself is recorded, and not listed back here.
  const entries = (query.data?.entries ?? []).filter((e) => e.kind !== 'audit_log');
  const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  const shown = entries.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const oldest = entries.at(-1);
  return (
    <StaffPage
      title="Who opened protected data"
      lede="Every opening of a reporter’s contact details or of a file’s original, with who did it, when, and the reason they wrote. Nothing here can be filtered out or changed. Opening this page is recorded too."
    >
      {query.isPending ? <p role="status">Reading the log…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data && entries.length === 0 ? (
        <Empty title="Nobody has opened anything protected">
          Each time somebody opens a reporter’s contact details or a file’s original, it is listed
          here with their reason.
        </Empty>
      ) : null}
      {entries.length > 0 ? (
        <Card>
          <CountLine
            parts={[
              `${String(entries.length)} ${entries.length === 1 ? 'opening' : 'openings'}`,
              oldest ? `since ${day(oldest.accessed_at)}` : null,
              'newest first',
              'times in UTC',
            ]}
          />
          <ScrollX label="Every opening of protected data, newest first">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Every opening of protected data, newest first</caption>
              <thead>
                <tr className="border-b border-ink-alt">
                  <th scope="col" className="py-2 pr-4 label-face text-xs">
                    When
                  </th>
                  <th scope="col" className="py-2 pr-4 label-face text-xs">
                    Who
                  </th>
                  <th scope="col" className="py-2 pr-4 label-face text-xs">
                    What
                  </th>
                  <th scope="col" className="py-2 pr-4 label-face text-xs">
                    Report
                  </th>
                  <th scope="col" className="py-2 label-face text-xs">
                    Their reason
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="border-b border-line align-top last:border-0">
                    <td className="py-2 pr-4 font-mono whitespace-nowrap">
                      <time dateTime={e.accessed_at}>{when(e.accessed_at)}</time>
                    </td>
                    <td className="py-2 pr-4 font-mono break-all">{e.staff_email}</td>
                    <td className="py-2 pr-4">
                      {LOOKED[e.kind] ?? 'Opened'}
                      {e.attachment_id === null ? '' : ` (file ${String(e.attachment_id)})`}
                    </td>
                    <td className="py-2 pr-4 font-mono whitespace-nowrap">
                      {e.public_ref ?? e.logbook ?? (
                        <span className="font-sans text-ink-alt">
                          {e.kind === 'desk_link' ? 'None' : 'A report'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 whitespace-pre-wrap">
                      {e.reason ?? <span className="text-ink-alt">None was asked for</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
          <Pagination page={page} pages={pages} onPage={setPage} label="Pages of the log" />
        </Card>
      ) : null}
    </StaffPage>
  );
}
