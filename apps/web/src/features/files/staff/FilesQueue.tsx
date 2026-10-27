/**
 * The moderator's files screens: the reports whose files nobody has decided
 * on yet, finding any report by its reference, and one report's files with
 * asking for evidence.
 *
 * A file waits from the moment it is sealed into a report until somebody
 * decides on it. Keeping a file unpublished on purpose is a decision, so it
 * leaves the queue; the file stays unpublished either way.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Btn } from '../../../mockup/Btn.tsx';
import { Empty } from '../../../mockup/Empty.tsx';
import { Note } from '../../../mockup/Note.tsx';
import { Err, Problem } from '../../../mockup/Notice.tsx';
import { Panel } from '../../../mockup/Panel.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { EvidenceRequests } from './EvidenceRequests.tsx';
import { ReportFiles } from './ReportFiles.tsx';
import { fileQueueQuery } from './queries.ts';

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

export function FilesQueue() {
  const query = useQuery(fileQueueQuery(''));
  return (
    <StaffPage
      title="Files"
      lede="Files sent with reports are never public until a moderator publishes them, and only if the reporter allows it. These reports have files nobody has decided on yet."
    >
      {query.isPending ? <p role="status">Reading the files…</p> : null}
      {query.isError ? <Problem>{query.error.message}</Problem> : null}
      {query.data ? (
        query.data.reports.length === 0 ? (
          <Empty title="Nothing waiting">
            Every file has been decided on. Files sent with new reports appear here.
          </Empty>
        ) : (
          [...query.data.reports]
            .sort((a, b) => b.received_at.localeCompare(a.received_at))
            .map((r) => (
              <article className="panel" key={r.thread_id}>
                <h2>
                  <span className="mono">{r.public_ref}</span>{' '}
                  <span className="n">
                    <span aria-hidden="true">{r.undecided}</span>
                    <span className="sr-only">
                      {plural(r.undecided, 'file waits', 'files wait')}
                    </span>
                  </span>
                </h2>
                <p>
                  {r.may_publish && r.files_permitted
                    ? 'The reporter allows their files to be published.'
                    : 'The reporter does not allow their files to be published.'}
                </p>
                <p className="m">
                  {r.logbook_title} · {plural(r.undecided, 'file waits', 'files wait')} of{' '}
                  {String(r.files)} · sent {new Date(r.received_at).toLocaleString()}
                </p>
                <div className="acts">
                  <Link
                    className="btn sm flat"
                    to="/files/$ref"
                    params={{ ref: r.public_ref }}
                    aria-label={`Open ${r.public_ref}`}
                  >
                    Open
                  </Link>
                </div>
              </article>
            ))
        )
      ) : null}
      <FindReport />
    </StaffPage>
  );
}

function FindReport() {
  const navigate = useNavigate();
  const id = useId();
  const [ref, setRef] = useState('');
  const [tried, setTried] = useState(false);
  const problem = ref.trim() ? null : 'Type a report’s reference first.';
  return (
    <Panel title="Find a report by its reference">
      <p className="muted" id={`${id}-help`}>
        Any report, whether or not it has files: this is also where you ask a reporter for evidence.
      </p>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (!problem)
            void navigate({ to: '/files/$ref', params: { ref: ref.trim().toUpperCase() } });
        }}
      >
        <input
          type="text"
          aria-label="Reference"
          aria-describedby={`${id}-help`}
          value={ref}
          placeholder="RL-XXXX-XX"
          autoComplete="off"
          onChange={(e) => {
            setRef(e.target.value);
          }}
        />
        <Btn sm flat type="submit">
          Open that report
        </Btn>
      </form>
      <Err>{tried ? problem : null}</Err>
    </Panel>
  );
}

/** One report's files and evidence asks, by its reference. */
export function ReportFilesPage({ reference }: { reference: string }) {
  const query = useQuery(fileQueueQuery(reference));
  const report = query.data?.reports[0];
  return (
    <StaffPage
      title={report ? `Files of ${report.public_ref}` : 'A report’s files'}
      mono
      lede={
        report
          ? `${report.logbook_title} · sent ${new Date(report.received_at).toLocaleString()}`
          : undefined
      }
      actions={
        <Link className="btn sm flat" to="/files">
          All files waiting
        </Link>
      }
    >
      {query.isPending ? <p role="status">Finding the report…</p> : null}
      {query.isError ? <Problem>{query.error.message}</Problem> : null}
      {query.data && !report ? (
        <Problem>There is no report with the reference {reference}.</Problem>
      ) : null}
      {report ? (
        <>
          {report.public_ref !== reference.toUpperCase() ? (
            <Note>
              {reference} is an earlier version of this report. These are the files of its newest
              version, {report.public_ref}.
            </Note>
          ) : null}
          <ReportFiles threadId={report.thread_id} />
          <EvidenceRequests threadId={report.thread_id} />
        </>
      ) : null}
    </StaffPage>
  );
}
