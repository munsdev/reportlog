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
import { Empty } from '../../mockup/Empty.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Pager } from '../../mockup/Pager.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { accessLogQuery } from './queries.ts';

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

/** The count line (settings-and-admin.md §13): "214 openings · since 1 Oct", from the oldest row. */
const countLine = (n: number, oldest: string) =>
  `${String(n)} ${n === 1 ? 'opening' : 'openings'} · since ${new Date(oldest).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;

const when = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ');

export function AccessLogPage() {
  const query = useQuery(accessLogQuery(EVERYTHING));
  const [page, setPage] = useState(1);
  // A read of the log itself is recorded, and not listed back here.
  const entries = (query.data?.entries ?? []).filter((e) => e.kind !== 'audit_log');
  const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  const shown = entries.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  return (
    <StaffPage
      title="Who opened protected data"
      lede="Every look at protected data. Contact details and files carry the reason given; opening a written account or link is recorded without one."
    >
      {query.isPending ? <p role="status">Reading the log…</p> : null}
      <ErrorLine error={query.error} />
      {query.data && entries.length === 0 ? (
        <Empty title="Nobody has opened anything protected">
          Each time somebody opens a reporter’s contact details or a file’s original, it is listed
          here with their reason.
        </Empty>
      ) : null}
      {entries.length > 0 ? (
        <>
          <p className="mono">
            {countLine(entries.length, entries[entries.length - 1]?.accessed_at ?? '')}
          </p>
          <Tbl
            cols={['When', 'Who', 'What', 'Report', 'Their reason']}
            widths="1fr 1.2fr 1.4fr 1fr 1.6fr"
            rows={shown.map((e) => ({
              key: e.id,
              cells: [
                <time dateTime={e.accessed_at}>{when(e.accessed_at)} UTC</time>,
                e.staff_email,
                <>
                  {LOOKED[e.kind] ?? 'Opened'}
                  {e.attachment_id === null ? '' : ` (file ${String(e.attachment_id)})`}
                  {e.read_ref === null ? '' : ` (${readName(e.read_ref)})`}
                </>,
                e.public_ref ? (
                  <span className="mono">{e.public_ref}</span>
                ) : (
                  (e.logbook ??
                  (e.kind === 'desk_link'
                    ? ''
                    : e.read_ref?.startsWith('tip-')
                      ? 'A tip'
                      : 'A report'))
                ),
                e.reason ?? 'None was asked for',
              ],
            }))}
          />
          <Pager page={page} pages={pages} onPage={setPage} label="Pages of the log" />
        </>
      ) : null}
    </StaffPage>
  );
}
