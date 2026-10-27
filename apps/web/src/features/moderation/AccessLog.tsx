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
  text_read: 'Opened a written account or link',
};

/** What a text_read opened, in words: report-12 is a written account, link-9 a link, tip-3-x a tip. */
const readName = (ref: string) =>
  ref.startsWith('link-')
    ? 'a link'
    : ref.startsWith('tip-')
      ? 'a tip’s description'
      : 'a written account';

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
      lede="Every look at protected data. Contact details and files carry the reason given; opening a written account or link is recorded without one."
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
            <table className="data-table">
              <caption className="sr-only">Every opening of protected data, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">What</th>
                  <th scope="col">Report</th>
                  <th scope="col">Their reason</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="font-mono whitespace-nowrap">
                      <time dateTime={e.accessed_at}>{when(e.accessed_at)}</time>
                    </td>
                    <td className="font-mono break-all">{e.staff_email}</td>
                    <td>
                      {LOOKED[e.kind] ?? 'Opened'}
                      {e.attachment_id === null ? '' : ` (file ${String(e.attachment_id)})`}
                      {e.read_ref === null ? '' : ` (${readName(e.read_ref)})`}
                    </td>
                    <td className="font-mono whitespace-nowrap">
                      {e.public_ref ?? e.logbook ?? (
                        <span className="font-sans text-ink-alt">
                          {e.kind === 'desk_link'
                            ? 'None'
                            : e.read_ref?.startsWith('tip-')
                              ? 'A tip'
                              : 'A report'}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-pre-wrap">
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
