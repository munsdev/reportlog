/**
 * Where the link in the confirmation email lands: /file/confirm/:token.
 *
 * OPENING THE LINK FILES NOTHING. Mail scanners open links, so looking is a
 * GET and filing is the button. The link keeps working afterwards and shows
 * where the report stands, in the only words a reporter is given: received,
 * or public. Which non-public state it is in is never said, because a
 * moderator can always revisit a decision.
 *
 * On a door this page calls only the two confirmation calls.
 */
import { confirmReport, getConfirmation } from '@reportlog/contracts';
import type { Confirmation } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Page } from '@/components/ui/page.tsx';
import { useGateMode } from '@/features/identity/gate.tsx';
import { ApiRequestError, call } from '@/lib/api.ts';

const confirmationQuery = (token: string) =>
  queryOptions({
    queryKey: ['confirmation', token],
    queryFn: ({ signal }) => call(getConfirmation, { params: { token }, signal }),
    retry: false,
  });

export function ConfirmPage({ token }: { token: string }) {
  const client = useQueryClient();
  const state = useQuery(confirmationQuery(token));
  const press = useMutation({
    mutationFn: () => call(confirmReport, { params: { token } }),
    onSuccess: (data) => {
      client.setQueryData(confirmationQuery(token).queryKey, { confirmation: data.confirmation });
    },
  });

  if (state.isPending) return <p role="status">Checking this link…</p>;
  if (state.isError) {
    const missing = state.error instanceof ApiRequestError && state.error.status === 404;
    return (
      <Page title="This link does not work" width="prose">
        <p>
          {missing
            ? 'It is not a link this site sent, or the report it was for has had its details erased. Check that the whole link was copied.'
            : state.error.message}
        </p>
      </Page>
    );
  }
  return (
    <Shown
      c={state.data.confirmation}
      justFiled={press.data?.just_confirmed === true}
      pressing={press.isPending}
      failure={press.isError ? press.error.message : null}
      onConfirm={() => {
        press.mutate();
      }}
    />
  );
}

function Shown({
  c,
  justFiled,
  pressing,
  failure,
  onConfirm,
}: {
  c: Confirmation;
  justFiled: boolean;
  pressing: boolean;
  failure: string | null;
  onConfirm: () => void;
}) {
  const onDoor = useGateMode() === 'door';
  if (c.state === 'unconfirmed') {
    return (
      <Page title="Confirm your report" width="prose" lede={`For “${c.logbook_title}”.`}>
        <p>
          Press the button to file your report. Once it is filed it is sealed: it can be corrected
          with a new version, but never quietly changed. A moderator reads it before anything is
          public.
        </p>
        <p className="text-sm text-ink-alt">
          This link works until {new Date(c.expires_at).toLocaleString()}.
        </p>
        {failure ? (
          <Alert tone="serious" title="It was not filed">
            {failure}
          </Alert>
        ) : null}
        <div>
          <Button type="button" onClick={onConfirm} disabled={pressing}>
            {pressing ? 'Filing…' : 'Confirm and file my report'}
          </Button>
        </div>
      </Page>
    );
  }
  // FILES WORKSTREAM: the attached files are still being made safe to keep.
  // Nothing was filed; pressing again files the report once they are ready
  // (or after a while without the ones that never become ready).
  if (c.state === 'preparing') {
    return (
      <Page
        title="Your files are still being prepared"
        width="prose"
        lede={`For “${c.logbook_title}”.`}
      >
        <p>
          Nothing has been filed yet. Every file is checked and re-encoded first, so that no
          location or camera details are kept in any copy that could be shown. That can take a
          minute or two for a video.
        </p>
        <ul className="list-disc pl-6">
          {c.files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <div>
          <Button type="button" onClick={onConfirm} disabled={pressing}>
            {pressing ? 'Trying…' : 'Try again'}
          </Button>
        </div>
      </Page>
    );
  }
  if (c.state === 'expired') {
    return (
      <Page title="This link has expired" width="prose">
        <p>
          Nothing was filed. Links work for 24 hours. If you still want to file it, send the report
          to “{c.logbook_title}” again.
        </p>
      </Page>
    );
  }
  return (
    <Page
      title={
        justFiled
          ? 'Your report is filed'
          : c.state === 'public'
            ? 'Your report is public'
            : 'Your report is filed'
      }
      width="prose"
    >
      <Alert tone="confirmed" title={`Its reference is ${c.public_ref}`}>
        {c.state === 'public'
          ? 'A moderator approved it, and it is on the public archive.'
          : 'A moderator reads every report before anything is public. You can come back to this link to see where it stands.'}
      </Alert>
      {c.files ? <FilesFiled files={c.files} /> : null}
      <p>
        Keep the reference: anybody can use it to check that the report has not been changed since
        it was filed.
      </p>
      {/* Behind the password, the rest of the site is not this page's to offer. */}
      {onDoor ? null : (
        <p className="flex flex-wrap gap-x-4">
          <Link to="/verify/$ref" params={{ ref: c.public_ref }} className="underline">
            Check its fingerprint
          </Link>
          <Link to="/mine" className="underline">
            See your reports
          </Link>
        </p>
      )}
    </Page>
  );
}

/** Which attached files are in the record, and why any are not. Said, never dropped quietly. */
function FilesFiled({
  files,
}: {
  files: NonNullable<Extract<Confirmation, { state: 'received' }>['files']>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p>
        {files.attached === 1
          ? 'One file is part of the report.'
          : `${String(files.attached)} files are part of the report.`}
      </p>
      {files.not_attached.length ? (
        <Alert tone="serious" title="Some files are not part of the report">
          <ul className="list-disc pl-6">
            {files.not_attached.map((f, i) => (
              <li key={`${f.name}-${String(i)}`}>
                {f.name}: {f.reason}.
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}
