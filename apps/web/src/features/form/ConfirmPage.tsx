/**
 * Where the link in the confirmation email lands: /file/confirm/:token.
 *
 * OPENING THE LINK FILES NOTHING. Mail scanners open links, so looking is a
 * GET and filing is the button. The link keeps working afterwards and shows
 * where the report stands, in the only words a reporter is given: received,
 * public, or counted (accepted in a logbook published as counts only). Which non-public state it is in is never said, because a
 * moderator can always revisit a decision.
 *
 * On a door this page calls only the two confirmation calls.
 */
import { confirmReport, getConfirmation } from '@reportlog/contracts';
import type { Confirmation } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { Eyebrow, Meta } from '@/components/ui/type.tsx';
import { useGateMode } from '@/features/identity/gate.tsx';
import { ApiRequestError, call } from '@/lib/api.ts';
import { TipOffer } from './tipOffer.tsx';

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

  if (state.isPending) {
    return (
      <Column>
        <p role="status">Checking this link…</p>
      </Column>
    );
  }
  if (state.isError) {
    const missing = state.error instanceof ApiRequestError && state.error.status === 404;
    return (
      <Column title="This link does not work">
        <p className="max-w-prose">
          {missing
            ? 'It is not a link this site sent, or the report it was for has had its details erased. Check that the whole link was copied.'
            : state.error.message}
        </p>
        <HomeLink />
      </Column>
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

/**
 * Every state in one centred column, the logbook as the eyebrow (filing.md
 * §09). The tab is named after the state, as every page's is.
 */
function Column({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string | undefined;
  title?: string | undefined;
  children: ReactNode;
}) {
  const site = plainSiteName(useSite().data);
  useEffect(() => {
    if (title) document.title = `${title} · ${site}`;
  }, [title, site]);
  return (
    <section className="mx-auto flex w-full max-w-[40rem] flex-col gap-6">
      {title ? (
        <div className="flex flex-col gap-2">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h1 className="font-display text-title">{title}</h1>
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Home, except on a door, where the front page is behind the password. */
function HomeLink() {
  const onDoor = useGateMode() === 'door';
  if (onDoor) return null;
  return (
    <p>
      <Button asChild variant="secondary">
        <a href="/">The front page</a>
      </Button>
    </p>
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
      <Column eyebrow={c.logbook_title} title="Confirm your report">
        <p className="max-w-prose">
          Press the button to file your report. Once it is filed it is sealed: it can be corrected
          with a new version, but never quietly changed. A moderator reads it before anything is
          public.
        </p>
        <p className="text-sm text-ink-alt">
          This link works until <Meta>{new Date(c.expires_at).toLocaleString()}</Meta>.
        </p>
        {failure ? (
          <Alert tone="serious" title="It was not filed">
            {failure}
          </Alert>
        ) : null}
        <div className="flex flex-col sm:items-start">
          <Button
            type="button"
            size="lg"
            block
            className="sm:w-auto"
            busy={pressing}
            busyLabel="Filing…"
            onClick={onConfirm}
          >
            Confirm and file my report
          </Button>
        </div>
      </Column>
    );
  }
  // FILES WORKSTREAM: the attached files are still being made safe to keep.
  // Nothing was filed; pressing again files the report once they are ready
  // (or after a while without the ones that never become ready).
  if (c.state === 'preparing') {
    return (
      <Column eyebrow={c.logbook_title} title="Your files are still being prepared">
        <p className="max-w-prose">
          Nothing has been filed yet. Every file is checked and re-encoded first, so that no
          location or camera details are kept in any copy that could be shown. That can take a
          minute or two for a video.
        </p>
        <ul
          aria-label="Your files"
          className="flex flex-col divide-y divide-line rounded-card border border-ink-alt bg-surface"
        >
          {c.files.map((f) => (
            <li key={f} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0 font-semibold break-all">{f}</span>
              <Meta className="shrink-0">Preparing</Meta>
            </li>
          ))}
        </ul>
        {failure ? (
          <Alert tone="serious" title="It was not filed">
            {failure}
          </Alert>
        ) : null}
        <div>
          <Button
            type="button"
            variant="secondary"
            busy={pressing}
            busyLabel="Trying…"
            onClick={onConfirm}
          >
            Try again
          </Button>
        </div>
      </Column>
    );
  }
  if (c.state === 'expired') {
    return (
      <Column eyebrow={c.logbook_title} title="This link has expired">
        <p className="max-w-prose">
          Nothing was filed. Links work for 24 hours. If you still want to file it, send the report
          to “{c.logbook_title}” again.
        </p>
        <p>
          <Button asChild variant="secondary">
            <a href={`/file/${encodeURIComponent(c.logbook_slug)}`}>File it again</a>
          </Button>
        </p>
      </Column>
    );
  }
  const title = justFiled
    ? 'Your report is filed'
    : c.state === 'public'
      ? 'Your report is public'
      : c.state === 'counted'
        ? 'Your report is counted'
        : 'Your report is filed';
  return (
    <Column eyebrow={c.logbook_title} title={title}>
      {/* Quiet, never teal: teal is a moderator's word, and this page says
          only where the report stands. */}
      <Alert tone="done" title={`Its reference is ${c.public_ref}`}>
        {c.state === 'public'
          ? 'A moderator approved it, and it is on the public archive.'
          : c.state === 'counted'
            ? // A counts-only logbook (Plan E): counted, its words shown nowhere.
              'A moderator approved it. This logbook publishes counts only, so your report is counted in the public figures, and its words are not shown on the site.'
            : // While the archive is off nothing is public, so the page never
              // says the word (decisions.md §5).
              c.archive_closed
              ? 'A moderator reads every report first. This site is not publishing reports at the moment, so a report it approves may be published later. You can come back to this link to see where it stands.'
              : 'A moderator reads every report before anything is public. You can come back to this link to see where it stands.'}
      </Alert>
      {c.files ? <FilesFiled files={c.files} /> : null}
      <p className="max-w-prose">
        Keep the reference: anybody can use it to check that the report has not been changed since
        it was filed.
      </p>
      {/* Behind the password, the rest of the site is not this page's to offer. */}
      {onDoor ? null : (
        <div className="flex flex-col items-start gap-2">
          {c.state === 'public' ? (
            <Button asChild variant="secondary">
              <Link to="/board/$ref" params={{ ref: c.public_ref }}>
                See it on the board
              </Link>
            </Button>
          ) : null}
          <p className="flex flex-wrap gap-x-2">
            <Button asChild variant="quiet">
              <Link to="/verify/$ref" params={{ ref: c.public_ref }}>
                Check it has not been changed
              </Link>
            </Button>
            <Button asChild variant="quiet">
              <Link to="/mine">See your reports</Link>
            </Button>
          </p>
        </div>
      )}
      {onDoor || c.state === 'public' ? null : <TipOffer />}
    </Column>
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
