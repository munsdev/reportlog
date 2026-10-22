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
import { useState } from 'react';
import { Alert } from '../../../components/ui/alert.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Card } from '../../../components/ui/card.tsx';
import { Count } from '../../../components/ui/count.tsx';
import { Empty } from '../../../components/ui/empty.tsx';
import { Field, FieldDescription, FieldError } from '../../../components/ui/field.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { Label } from '../../../components/ui/label.tsx';
import { Page } from '../../../components/ui/page.tsx';
import { Meta } from '../../../components/ui/type.tsx';
import { EvidenceRequests } from './EvidenceRequests.tsx';
import { ReportFiles } from './ReportFiles.tsx';
import { fileQueueQuery } from './queries.ts';

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

export function FilesQueue() {
  const query = useQuery(fileQueueQuery(''));
  return (
    <Page
      title="Files"
      lede="Files sent with reports are never public until a moderator publishes them, and only if the reporter allows it. These reports have files nobody has decided on yet."
    >
      <FindReport />
      {query.isPending ? <p role="status">Reading the files…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? (
        query.data.reports.length === 0 ? (
          <Empty title="Nothing waiting">
            Every file has been decided on. Files sent with new reports appear here.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Reports with files waiting">
            {[...query.data.reports]
              .sort((a, b) => b.received_at.localeCompare(a.received_at))
              .map((r) => (
                <li key={r.thread_id}>
                  <Card className="flex-row flex-wrap items-center gap-3 p-4">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold">{r.public_ref}</span>
                        <Count
                          value={r.undecided}
                          label={plural(r.undecided, 'file waits', 'files wait')}
                        />
                      </p>
                      <p className="text-sm">
                        {r.may_publish && r.files_permitted
                          ? 'The reporter allows their files to be published.'
                          : 'The reporter does not allow their files to be published.'}
                      </p>
                      <Meta>
                        {r.logbook_title} · {plural(r.undecided, 'file waits', 'files wait')} of{' '}
                        {String(r.files)} · sent {new Date(r.received_at).toLocaleString()}
                      </Meta>
                    </div>
                    <Button asChild variant="secondary">
                      <Link
                        to="/files/$ref"
                        params={{ ref: r.public_ref }}
                        aria-label={`Open ${r.public_ref}`}
                      >
                        Open
                      </Link>
                    </Button>
                  </Card>
                </li>
              ))}
          </ul>
        )
      ) : null}
    </Page>
  );
}

function FindReport() {
  const navigate = useNavigate();
  const [ref, setRef] = useState('');
  const [tried, setTried] = useState(false);
  const problem = ref.trim() ? null : 'Type a report’s reference first.';
  return (
    <form
      className="flex max-w-prose flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (!problem)
          void navigate({ to: '/files/$ref', params: { ref: ref.trim().toUpperCase() } });
      }}
    >
      <Field>
        <Label>Find a report by its reference</Label>
        <FieldDescription>
          Any report, whether or not it has files: this is also where you ask a reporter for
          evidence.
        </FieldDescription>
        <Input
          value={ref}
          placeholder="RL-…"
          autoComplete="off"
          onChange={(e) => {
            setRef(e.target.value);
          }}
        />
        <FieldError>{tried ? problem : null}</FieldError>
      </Field>
      <div>
        <Button type="submit" variant="secondary">
          Open that report
        </Button>
      </div>
    </form>
  );
}

/** One report's files and evidence asks, by its reference. */
export function ReportFilesPage({ reference }: { reference: string }) {
  const query = useQuery(fileQueueQuery(reference));
  const report = query.data?.reports[0];
  return (
    <Page
      title={report ? `Files of ${report.public_ref}` : 'A report’s files'}
      lede={
        report
          ? `${report.logbook_title} · sent ${new Date(report.received_at).toLocaleString()}`
          : undefined
      }
      actions={
        <Button asChild variant="secondary">
          <Link to="/files">All files waiting</Link>
        </Button>
      }
    >
      {query.isPending ? <p role="status">Finding the report…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data && !report ? (
        <Alert tone="serious">There is no report with the reference {reference}.</Alert>
      ) : null}
      {report ? (
        <>
          {report.public_ref !== reference.toUpperCase() ? (
            <Alert>
              {reference} is an earlier version of this report. These are the files of its newest
              version, {report.public_ref}.
            </Alert>
          ) : null}
          <ReportFiles threadId={report.thread_id} />
          <EvidenceRequests threadId={report.thread_id} />
        </>
      ) : null}
    </Page>
  );
}
