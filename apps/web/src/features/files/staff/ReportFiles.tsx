/**
 * One report's files, for a moderator: each file's re-encoded copy, its
 * record, and the decision on it.
 *
 * BUILT TO BE DROPPED INTO THE MODERATION SCREEN (workstream D1) as well as
 * standing on its own at /files/:ref:
 *
 *   <ReportFiles threadId={thread} reportPublic={isPublic} />
 *
 * `reportPublic`, when given, says whether the report's text is on the board:
 * a published file is shown only while it is, so the screen says so.
 * `reportApproved`, when given and false, puts "Approve the report first" in
 * place of Publish… (moderation.md section 04): a moderator may publish the
 * text and not the files, never the reverse, so the files wait for the text.
 *
 * CONSENT IS THE CEILING, MODERATION IS THE FLOOR. A moderator may always
 * withhold or refuse a file. Publishing is offered only while the report's
 * sealed answer AND the reporter's file permission both allow it; otherwise
 * the screen says why, in place of the button. The server and the database
 * refuse it regardless.
 *
 * WHAT IS SHOWN IS THE COPY THAT WOULD BE PUBLISHED, re-encoded with its
 * camera metadata gone, and only when asked for. The original is evidence:
 * opening it needs a reason, and the opening goes on the file's record.
 */
import { FILE_PATHS, setFilePublication } from '@reportlog/contracts';
import type { ResponseOf, ThreadFile, getThreadFiles } from '@reportlog/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Btn } from '../../../mockup/Btn.tsx';
import { Note } from '../../../mockup/Note.tsx';
import { Problem } from '../../../mockup/Notice.tsx';
import { Panel } from '../../../mockup/Panel.tsx';
import { call } from '../../../lib/api.ts';
import { AskDialog } from './AskDialog.tsx';
import { threadFilesQuery, refreshStaffViews } from './queries.ts';
import { ACTOR, PUBLICATION, describeFile, eventLabel, whyNotPublishable } from './words.ts';
import type { Consent } from './words.ts';

type Events = ResponseOf<typeof getThreadFiles>['events'];

export function ReportFiles({
  threadId,
  reportPublic,
  reportApproved,
}: {
  threadId: string;
  reportPublic?: boolean;
  reportApproved?: boolean;
}) {
  const query = useQuery(threadFilesQuery(threadId));
  if (query.isPending) return <p role="status">Reading the files…</p>;
  if (query.isError) return <Problem>{query.error.message}</Problem>;
  const { files, events, refused, may_publish, files_permitted, withdrawn } = query.data;
  const consent = { may_publish, files_permitted, withdrawn };
  return (
    <>
      <ConsentSummary {...consent} />
      <Panel title={`Files (${String(files.length)})`}>
        {reportPublic === false && !withdrawn ? (
          <p className="muted">
            The report’s text is not on the board, so nothing published here is shown until it is.
          </p>
        ) : null}
        {files.length === 0 ? (
          <p>This report has no files.</p>
        ) : (
          files.map((f) => (
            <FileCard
              key={f.id}
              file={f}
              consent={consent}
              approved={reportApproved}
              events={events.filter((e) => e.attachment_id === f.id)}
            />
          ))
        )}
        {refused.length ? (
          // A closed row: what never became part of the report is worth a look, not a place.
          <details className="tech">
            <summary>Sent and not accepted ({String(refused.length)})</summary>
            <div className="in" style={{ fontFamily: 'var(--rl-font-sans)', wordBreak: 'normal' }}>
              <p>
                These never became part of the report. Whoever sent them was told each one, with the
                same reason.
              </p>
              <ul aria-label="Files sent and not accepted">
                {refused.map((r, i) => (
                  <li key={i}>
                    {r.name}: {r.reason} ({new Date(r.at).toLocaleString()})
                  </li>
                ))}
              </ul>
            </div>
          </details>
        ) : null}
      </Panel>
    </>
  );
}

/** A file's state as the mock-up's chip. */
function StateChip({ file: f }: { file: ThreadFile }) {
  if (f.erased) return <span className="st off">Erased</span>;
  if (f.publication === 'published') return <span className="st ok">{PUBLICATION.published}</span>;
  if (f.publication === 'refused') return <span className="st bad">{PUBLICATION.refused}</span>;
  return <span className="st off">{PUBLICATION.withheld}</span>;
}

/**
 * The file's type in three or four letters, in place of a thumbnail: the
 * copy is shown only when somebody asks for it (above), not on arrival.
 */
function TypeMark({ file: f }: { file: ThreadFile }) {
  const sub = (f.media_type.split('/')[1] ?? f.media_type).replace(/^x-/, '');
  const mark = (sub === 'jpeg' ? 'jpg' : sub).slice(0, 4).toUpperCase();
  return (
    <span aria-hidden="true" className="fic">
      {mark}
    </span>
  );
}

function ConsentSummary({ may_publish, files_permitted, withdrawn }: Consent) {
  if (withdrawn) {
    return (
      <Note>
        <b>The reporter withdrew this report.</b> Its files were taken down when it was withdrawn,
        and they stay down.
      </Note>
    );
  }
  if (may_publish && files_permitted) {
    return (
      <Note>
        <b>The reporter allows their files to be published.</b> You decide which, if any. A file you
        publish needs a description for people who cannot see it.
      </Note>
    );
  }
  return (
    <Note warn>
      <b>These files cannot be published.</b>{' '}
      {!may_publish
        ? 'The reporter did not agree to their report being published. You can still keep files unpublished or refuse them.'
        : 'The reporter has not agreed to their files being published, and only they can change that. You can still keep files unpublished or refuse them.'}
    </Note>
  );
}

function FileCard({
  file: f,
  consent,
  approved,
  events,
}: {
  file: ThreadFile;
  consent: Consent;
  approved: boolean | undefined;
  events: Events;
}) {
  const qc = useQueryClient();
  const [showing, setShowing] = useState(false);
  const refresh = () => refreshStaffViews(qc);
  const decide = async (body: {
    publication: ThreadFile['publication'];
    alt_text?: string;
    reason: string;
  }) => {
    await call(setFilePublication, { params: { id: f.id }, body });
    await refresh();
  };
  const blocked = whyNotPublishable(f, consent);
  const name = f.original_name ?? `File ${String(f.ordinal)}`;

  return (
    <div className="filerow">
      <TypeMark file={f} />
      <div>
        <h3>
          <span className="sr-only">File {String(f.ordinal)}: </span>
          <b>{name}</b> <StateChip file={f} />
        </h3>
        <p className="m">{describeFile(f)}</p>
        {f.publication === 'published' && f.alt_text ? <p>Described as: “{f.alt_text}”</p> : null}
        <p className="m" style={{ wordBreak: 'break-all' }}>
          Fingerprint of the file as sent (SHA-256): {f.sha256}
        </p>

        {f.erased ? null : (
          <details
            className="tech"
            open={showing}
            onToggle={(e) => {
              setShowing(e.currentTarget.open);
            }}
          >
            <summary>{showing ? 'Hide the copy' : 'Show the copy that would be published'}</summary>
            <div className="in">{showing ? <Preview file={f} /> : null}</div>
          </details>
        )}

        {f.erased ? null : (
          <div className="acts">
            {f.publication !== 'published' && blocked === null && approved === false ? (
              <b>Approve the report first</b>
            ) : null}
            {f.publication !== 'published' && blocked === null && approved !== false ? (
              <AskDialog
                trigger={(open) => (
                  <Btn sm flat look="ink" onClick={open}>
                    Publish…
                  </Btn>
                )}
                title={`Publish ${name}`}
                description="The re-encoded copy goes on the public report. The original never does."
                questions={[
                  {
                    label: 'Describe the file for somebody who cannot see it',
                    hint: 'This is shown with the file on the public report. Say what it shows, not what it proves.',
                    min: 3,
                    max: 1000,
                    tooShort: 'A description is needed to publish a file.',
                  },
                  {
                    label: 'Why publish it?',
                    hint: 'For the file’s record. Other moderators read it.',
                    multiline: true,
                    max: 2000,
                    tooShort: 'Give a reason, for the record.',
                  },
                ]}
                finish="Publish this file"
                onFinish={([alt, reason]) =>
                  decide({ publication: 'published', alt_text: alt ?? '', reason: reason ?? '' })
                }
              />
            ) : null}
            {f.publication !== 'refused' ? (
              <AskDialog
                trigger={(open) => (
                  <Btn sm flat onClick={open}>
                    {f.publication === 'published' ? 'Take it down…' : 'Keep it unpublished…'}
                  </Btn>
                )}
                title={
                  f.publication === 'published' ? `Take ${name} down` : `Keep ${name} unpublished`
                }
                description="It stays with the report, unpublished. It can be published later if the reporter still allows it."
                questions={[
                  {
                    label: 'Why?',
                    hint: 'For the file’s record.',
                    multiline: true,
                    max: 2000,
                    tooShort: 'Give a reason, for the record.',
                  },
                ]}
                finish={f.publication === 'published' ? 'Take it down' : 'Keep it unpublished'}
                onFinish={([reason]) => decide({ publication: 'withheld', reason: reason ?? '' })}
              />
            ) : null}
            {f.publication !== 'refused' ? (
              <AskDialog
                trigger={(open) => (
                  <Btn sm flat onClick={open}>
                    Refuse…
                  </Btn>
                )}
                title={`Refuse ${name}`}
                description="Refusing says this file is not to be published. It stays with the report as evidence, and its fingerprint stays in the report."
                questions={[
                  {
                    label: 'Why refuse it?',
                    hint: 'For the file’s record.',
                    multiline: true,
                    max: 2000,
                    tooShort: 'Give a reason, for the record.',
                  },
                ]}
                finish="Refuse this file"
                onFinish={([reason]) => decide({ publication: 'refused', reason: reason ?? '' })}
              />
            ) : null}
            <OpenOriginal file={f} name={name} onOpened={refresh} />
          </div>
        )}
        {f.publication !== 'published' && blocked !== null && !f.erased ? (
          <p className="muted">{blocked}</p>
        ) : null}

        <FileRecord events={events} />
      </div>
    </div>
  );
}

function OpenOriginal({
  file: f,
  name,
  onOpened,
}: {
  file: ThreadFile;
  name: string;
  onOpened: () => Promise<unknown>;
}) {
  return (
    <AskDialog
      trigger={(open) => (
        <Btn sm flat look="ghost" onClick={open}>
          Open the original…
        </Btn>
      )}
      title={`The original of ${name}`}
      description="The original is the file exactly as it was sent, with whatever it carries about where and on what it was made. Opening it is recorded on the file, with your reason."
      questions={[
        {
          label: 'Why do you need the original?',
          multiline: true,
          min: 10,
          // The server refuses a longer one (decision 31), as it does for contact details.
          max: 500,
          tooShort: 'Say why in a sentence: it is kept on the file’s record.',
        },
      ]}
      finish="Next"
      onFinish={() => Promise.resolve()}
      after={([reason]) => (
        <div className="col">
          <p>The original downloads to this device. Keep it only as long as you need it.</p>
          <div className="acts">
            <a
              className="btn sm flat ink"
              href={`${FILE_PATHS.moderatorView(f.id, 'original')}?${new URLSearchParams({ reason: reason ?? '' }).toString()}`}
              download
              onClick={() => {
                // The server writes the record as it sends the file; read it again shortly after.
                setTimeout(() => void onOpened(), 1000);
              }}
            >
              Download the original
            </a>
          </div>
        </div>
      )}
    />
  );
}

function Preview({ file: f }: { file: ThreadFile }) {
  const [page, setPage] = useState(1);
  const label = `The copy of ${f.original_name ?? `file ${String(f.ordinal)}`} that would be published`;
  const type = f.rendition_media_type;
  const src = FILE_PATHS.moderatorView(f.id, 'rendition');
  if (type.startsWith('video/')) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption -- a reporter's recording has no captions to give; the moderator is looking at the copy itself
      <video
        style={{ maxHeight: 384, maxWidth: '100%' }}
        controls
        preload="metadata"
        playsInline
        src={src}
        aria-label={label}
        {...(f.has_poster ? { poster: FILE_PATHS.moderatorView(f.id, 'poster') } : {})}
      />
    );
  }
  if (type.startsWith('audio/')) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption -- as for video, above
      <audio style={{ width: '100%' }} controls preload="metadata" src={src} aria-label={label} />
    );
  }
  return (
    <figure style={{ margin: 0, display: 'grid', gap: 8 }}>
      <img
        style={{ maxHeight: 512, maxWidth: '100%', objectFit: 'contain' }}
        src={page === 1 ? src : FILE_PATHS.moderatorPage(f.id, page)}
        alt={f.pages > 1 ? `${label}, page ${String(page)}` : label}
      />
      {f.pages > 1 ? (
        <figcaption className="acts">
          <Btn
            sm
            flat
            disabled={page === 1}
            onClick={() => {
              setPage(page - 1);
            }}
          >
            Previous page
          </Btn>
          <span>
            Page {String(page)} of {String(f.pages)}
          </span>
          <Btn
            sm
            flat
            disabled={page === f.pages}
            onClick={() => {
              setPage(page + 1);
            }}
          >
            Next page
          </Btn>
        </figcaption>
      ) : null}
    </figure>
  );
}

function FileRecord({ events }: { events: Events }) {
  if (!events.length) return <p className="muted">Nobody has decided on it yet.</p>;
  return (
    <details className="tech">
      <summary>This file’s record ({String(events.length)})</summary>
      <div className="in" style={{ fontFamily: 'var(--rl-font-sans)', wordBreak: 'normal' }}>
        <ol aria-label="This file’s record">
          {events.map((e, i) => (
            <li key={`${e.at}-${String(i)}`}>
              <b>{eventLabel(e.action)}</b> by {e.actor_email ?? ACTOR[e.actor] ?? e.actor},{' '}
              {new Date(e.at).toLocaleString()}
              {e.reason ? (
                <span className="muted" style={{ display: 'block' }}>
                  “{e.reason}”
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
