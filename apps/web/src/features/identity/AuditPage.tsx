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
import { call } from '../../lib/api.ts';
import { Empty } from '../../mockup/Empty.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Pager } from '../../mockup/Pager.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { useMe } from './session.ts';
import { SignInPrompt } from './SignInPrompt.tsx';

type AuditEntry = ResponseOf<typeof listAudit>['entries'][number];

const PER_PAGE = 25;

/** What a change did, without who did it (that is the table's own column). */
export function auditWhat(e: AuditEntry): string {
  // A copy of the whole archive taken off the server (the owner's backups
  // and exports): nobody else is its subject.
  if (e.action === 'download') return `Downloaded ${e.detail}`;
  const verb = e.action === 'grant' ? 'Gave' : e.action === 'revoke' ? 'Took from' : 'Changed, for';
  return `${verb} ${e.subject_email}: ${e.detail}${e.organization ? ` (${e.organization})` : ''}`;
}

/** One change as a sentence: who did what to whom. */
export function auditSentence(e: AuditEntry): string {
  return `${e.actor_email} ${auditWhat(e).replace(/^./, (c) => c.toLowerCase())}`;
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
      lede="Every role and access change, and every copy of the archive taken off the server, newest first."
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
