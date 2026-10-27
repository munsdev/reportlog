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
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { FollowBand } from '@/features/follow/FollowBand.tsx';
import { useGateMode } from '@/features/identity/gate.tsx';
import { ApiRequestError, call } from '@/lib/api.ts';
import { Btn, BtnLink, btnClass } from '@/mockup/Btn.tsx';
import { Note } from '@/mockup/Note.tsx';
import { useBodyClass } from '@/mockup/useBodyClass.ts';
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
        <p>
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
 * Every state in one column, the logbook as the eyebrow (t-confirm.html,
 * t-confirmed.html). The tab is named after the state, as every page's is.
 */
function Column({
  eyebrow,
  title,
  follow = false,
  children,
}: {
  eyebrow?: string | undefined;
  title?: string | undefined;
  /** The Follow along band under it: a filed report only. */
  follow?: boolean;
  children: ReactNode;
}) {
  useBodyClass('light', 'form');
  const site = plainSiteName(useSite().data);
  useEffect(() => {
    if (title) document.title = `${title} · ${site}`;
  }, [title, site]);
  return (
    <div data-bleed>
      <div className="wrap" style={{ paddingTop: 28 }}>
        <div style={{ display: 'grid', gap: 18, maxWidth: 720 }}>
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          {title ? (
            <h1 className="h-page" id="h1">
              {title}
            </h1>
          ) : null}
          {children}
        </div>
      </div>
      {follow ? <FollowBand placement="after_filing" bleed /> : null}
    </div>
  );
}

/** Home, except on a door, where the front page is behind the password. */
function HomeLink() {
  const onDoor = useGateMode() === 'door';
  if (onDoor) return null;
  return (
    <BtnLink href="/" style={{ justifySelf: 'start' }}>
      The front page
    </BtnLink>
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
        <p>
          Press the button to file your report. Until you do, nothing is filed. A moderator reads it
          before anything is public.
        </p>
        <p className="m">This link works until {new Date(c.expires_at).toLocaleString()}.</p>
        {failure ? (
          <Note warn role="alert">
            <b>It was not filed.</b> {failure}
          </Note>
        ) : null}
        <Btn
          sm
          flat
          look="go"
          style={{ justifySelf: 'start' }}
          busy={pressing}
          busyLabel="Filing…"
          onClick={onConfirm}
        >
          Confirm and file my report
        </Btn>
      </Column>
    );
  }
  // FILES WORKSTREAM: the attached files are still being made safe to keep.
  // Nothing was filed; pressing again files the report once they are ready
  // (or after a while without the ones that never become ready).
  if (c.state === 'preparing') {
    return (
      <Column eyebrow={c.logbook_title} title="Your files are still being prepared">
        <p>
          Nothing has been filed yet. Every file is checked and re-encoded first, so that no
          location or camera details are kept in any copy that could be shown. That can take a
          minute or two for a video.
        </p>
        <div className="review" aria-label="Your files">
          {c.files.map((f) => (
            <div key={f}>
              <span className="a" style={{ overflowWrap: 'anywhere' }}>
                {f}
              </span>
              <span className="m">Preparing</span>
            </div>
          ))}
        </div>
        {failure ? (
          <Note warn role="alert">
            <b>It was not filed.</b> {failure}
          </Note>
        ) : null}
        <Btn
          sm
          flat
          style={{ justifySelf: 'start' }}
          busy={pressing}
          busyLabel="Trying…"
          onClick={onConfirm}
        >
          Try again
        </Btn>
      </Column>
    );
  }
  if (c.state === 'expired') {
    return (
      <Column eyebrow={c.logbook_title} title="This link has expired">
        <p>
          Nothing was filed. Links work for 90 days. If you still want to file it, send the report
          to “{c.logbook_title}” again.
        </p>
        <BtnLink
          href={`/file/${encodeURIComponent(c.logbook_slug)}`}
          style={{ justifySelf: 'start' }}
        >
          File it again
        </BtnLink>
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
    <Column eyebrow={c.logbook_title} title={title} follow={!onDoor}>
      {/* Quiet, never teal: teal is a moderator's word, and this page says
          only where the report stands. */}
      <div className="card">
        <span className="tag">Its reference</span>
        <p className="ref">{c.public_ref}</p>
        <p>
          {c.state === 'public'
            ? 'A moderator approved it, and it is on the public archive.'
            : c.state === 'counted'
              ? // A counts-only logbook (Plan E): counted, its words shown nowhere.
                'A moderator approved it. This logbook publishes counts only, so your report is counted in the public figures, and its words are not shown on the site.'
              : // While the archive is off nothing is public, so the page never
                // says the word (decisions.md §5).
                c.archive_closed
                ? 'A moderator reads every report first. This site is not publishing reports at the moment, so a report it approves may be published later. You can come back to this link to see where it stands.'
                : 'A moderator reads every report before anything is public. You can come back to this link to see where it stands.'}{' '}
          Keep the reference. Sign in with your email to find it under your reports.
        </p>
      </div>
      {c.files ? <FilesFiled files={c.files} /> : null}
      {/* Behind the password, the rest of the site is not this page's to offer. */}
      {onDoor ? null : (
        <div className="btn-row">
          {c.state === 'public' ? (
            <Link className={btnClass({})} to="/board/$ref" params={{ ref: c.public_ref }}>
              See it on the board
            </Link>
          ) : (
            <Link className={btnClass({})} to="/board">
              See the board
            </Link>
          )}
          <Link className={btnClass({})} to="/mine">
            See your reports
          </Link>
        </div>
      )}
      {onDoor || c.state === 'public' ? null : (
        <div className="cards two">
          <TipOffer />
        </div>
      )}
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
    <>
      <p>
        {files.attached === 1
          ? 'One file is part of the report.'
          : `${String(files.attached)} files are part of the report.`}
      </p>
      {files.not_attached.length ? (
        <Note warn role="alert">
          <b>Some files are not part of the report.</b>
          <ul style={{ paddingLeft: 18 }}>
            {files.not_attached.map((f, i) => (
              <li key={`${f.name}-${String(i)}`}>
                {f.name}: {f.reason}.
              </li>
            ))}
          </ul>
        </Note>
      ) : null}
    </>
  );
}
