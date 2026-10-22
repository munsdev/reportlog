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
import { Alert } from '../../../components/ui/alert.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { call } from '../../../lib/api.ts';
import { AskDialog } from './AskDialog.tsx';
import { threadFilesQuery, refreshStaffViews } from './queries.ts';
import { ACTOR, PUBLICATION, describeFile, eventLabel, whyNotPublishable } from './words.ts';
import type { Consent } from './words.ts';

type Events = ResponseOf<typeof getThreadFiles>['events'];

export function ReportFiles({
  threadId,
  reportPublic,
}: {
  threadId: string;
  reportPublic?: boolean;
}) {
  const query = useQuery(threadFilesQuery(threadId));
  if (query.isPending) return <p role="status">Reading the files…</p>;
  if (query.isError) return <Alert tone="serious">{query.error.message}</Alert>;
  const { files, events, refused, may_publish, files_permitted, withdrawn } = query.data;
  const consent = { may_publish, files_permitted, withdrawn };
  return (
    <section className="flex flex-col gap-4" aria-labelledby="report-files-heading">
      <h2 id="report-files-heading" className="font-display text-2xl font-bold">
        Files
      </h2>
      <ConsentSummary {...consent} />
      {reportPublic === false && !withdrawn ? (
        <p className="text-sm text-ink-alt">
          The report’s text is not on the board, so nothing published here is shown until it is.
        </p>
      ) : null}
      {files.length === 0 ? (
        <p>This report has no files.</p>
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Files on this report">
          {files.map((f) => (
            <li key={f.id}>
              <FileCard
                file={f}
                consent={consent}
                events={events.filter((e) => e.attachment_id === f.id)}
              />
            </li>
          ))}
        </ul>
      )}
      {refused.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-bold">Sent and not accepted ({String(refused.length)})</h3>
          <p className="text-sm text-ink-alt">
            These never became part of the report. Whoever sent them was told each one, with the
            same reason.
          </p>
          <ul className="list-disc pl-6" aria-label="Files sent and not accepted">
            {refused.map((r, i) => (
              <li key={i}>
                {r.name}: {r.reason} ({new Date(r.at).toLocaleString()})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ConsentSummary({ may_publish, files_permitted, withdrawn }: Consent) {
  if (withdrawn) {
    return (
      <Alert title="The reporter withdrew this report">
        Its files were taken down when it was withdrawn, and they stay down.
      </Alert>
    );
  }
  if (may_publish && files_permitted) {
    return (
      <Alert title="The reporter allows their files to be published">
        You decide which, if any. A file you publish needs a description for people who cannot see
        it.
      </Alert>
    );
  }
  return (
    <Alert title="These files cannot be published">
      {!may_publish
        ? 'The reporter did not agree to their report being published. You can still keep files unpublished or refuse them.'
        : 'The reporter has not agreed to their files being published, and only they can change that. You can still keep files unpublished or refuse them.'}
    </Alert>
  );
}

function FileCard({
  file: f,
  consent,
  events,
}: {
  file: ThreadFile;
  consent: Consent;
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
  const state = f.erased ? 'Erased' : PUBLICATION[f.publication];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="sr-only">File {String(f.ordinal)}: </span>
          {name}
        </CardTitle>
        <p className="text-sm text-ink-alt">{describeFile(f)}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p>
          <span className="font-semibold">Now: {state}</span>
          {f.publication === 'published' && f.alt_text ? (
            <span className="block text-ink-alt">Described as: “{f.alt_text}”</span>
          ) : null}
        </p>
        <p className="text-sm break-all text-ink-alt">
          Fingerprint of the file as sent (SHA-256): <span className="font-mono">{f.sha256}</span>
        </p>

        {f.erased ? null : (
          <div>
            <Button
              variant="secondary"
             
              aria-expanded={showing}
              onClick={() => {
                setShowing((s) => !s);
              }}
            >
              {showing ? 'Hide the copy' : 'Show the copy that would be published'}
            </Button>
            {showing ? <Preview file={f} /> : null}
          </div>
        )}

        {f.erased ? null : (
          <div className="flex flex-wrap gap-2">
            {f.publication !== 'published' && blocked === null ? (
              <AskDialog
                trigger={<Button>Publish…</Button>}
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
                trigger={
                  <Button variant="secondary">
                    {f.publication === 'published' ? 'Take it down…' : 'Keep it unpublished…'}
                  </Button>
                }
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
                trigger={
                  <Button variant="secondary">
                    Refuse…
                  </Button>
                }
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
          <p className="text-sm text-ink-alt">{blocked}</p>
        ) : null}

        <FileRecord events={events} />
      </CardContent>
    </Card>
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
      trigger={
        <Button variant="quiet">
          Open the original…
        </Button>
      }
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
        <div className="flex flex-col gap-3">
          <p>The original downloads to this device. Keep it only as long as you need it.</p>
          <div>
            <Button asChild>
              <a
                href={`${FILE_PATHS.moderatorView(f.id, 'original')}?${new URLSearchParams({ reason: reason ?? '' }).toString()}`}
                download
                onClick={() => {
                  // The server writes the record as it sends the file; read it again shortly after.
                  setTimeout(() => void onOpened(), 1000);
                }}
              >
                Download the original
              </a>
            </Button>
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
        className="mt-3 max-h-96 max-w-full rounded-card border border-line"
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
      <audio className="mt-3 w-full" controls preload="metadata" src={src} aria-label={label} />
    );
  }
  return (
    <figure className="mt-3 flex flex-col gap-2">
      <img
        className="max-h-[32rem] max-w-full rounded-card border border-line object-contain"
        src={page === 1 ? src : FILE_PATHS.moderatorPage(f.id, page)}
        alt={f.pages > 1 ? `${label}, page ${String(page)}` : label}
      />
      {f.pages > 1 ? (
        <figcaption className="flex items-center gap-3 text-sm">
          <Button
           
            variant="secondary"
            disabled={page === 1}
            onClick={() => {
              setPage(page - 1);
            }}
          >
            Previous page
          </Button>
          <span>
            Page {String(page)} of {String(f.pages)}
          </span>
          <Button
           
            variant="secondary"
            disabled={page === f.pages}
            onClick={() => {
              setPage(page + 1);
            }}
          >
            Next page
          </Button>
        </figcaption>
      ) : null}
    </figure>
  );
}

function FileRecord({ events }: { events: Events }) {
  if (!events.length) return <p className="text-sm text-ink-alt">Nobody has decided on it yet.</p>;
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold">
        This file’s record ({String(events.length)})
      </summary>
      <ol className="mt-2 flex flex-col gap-2 text-sm" aria-label="This file’s record">
        {events.map((e, i) => (
          <li key={`${e.at}-${String(i)}`}>
            <span className="font-semibold">{eventLabel(e.action)}</span> by{' '}
            {e.actor_email ?? ACTOR[e.actor] ?? e.actor}, {new Date(e.at).toLocaleString()}
            {e.reason ? <span className="block text-ink-alt">“{e.reason}”</span> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
