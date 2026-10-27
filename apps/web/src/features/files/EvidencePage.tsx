/**
 * Answering a request for evidence: /evidence/:token, from a link in an email.
 *
 * DELIBERATELY SMALL. What was asked, in the moderator's own words, which
 * report it is about (by the reference the reporter already has), and a place
 * to put files. No report text, and no way to change an answer: a guessed
 * link must not become a way to read somebody's account, and the reporter
 * was asked for files, not invited to revise what they said.
 *
 * Files are prepared (re-encoded, checked) as they arrive, so the page waits
 * until each says Ready before it offers to send. Nothing is added to the
 * report until Send.
 */
import {
  FILE_PATHS,
  createEvidenceUpload,
  getEvidenceRequest,
  getEvidenceUploads,
  removeEvidenceUpload,
  sendEvidence,
} from '@reportlog/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Narrow, TokenPage } from '@/mockup/Narrow.tsx';
import { Note, Panel } from '@/mockup/Panel.tsx';
import { useBodyClass } from '@/mockup/useBodyClass.ts';
import { PERMISSION_WORDS } from '@/features/form/permissionWords.ts';
import { call } from '@/lib/api.ts';
import { FilePicker } from './FilesCard.tsx';
import { useUploader } from './uploader.ts';
import type { Target } from './uploader.ts';

const IN_FLIGHT = new Set(['uploading', 'uploaded', 'pending', 'processing']);

/** Mock-up t-evidence.html. */
export function EvidencePage({ token }: { token: string }) {
  useBodyClass('light', 'form');
  const ask = useQuery({
    queryKey: ['evidence', token],
    queryFn: ({ signal }) => call(getEvidenceRequest, { params: { token }, signal }),
    retry: false,
  });
  const target = useMemo<Target>(
    () => ({
      async create(file) {
        return (await call(createEvidenceUpload, { params: { token }, body: file })).slot_token;
      },
      put(slot) {
        return {
          url: FILE_PATHS.evidenceUpload(token, slot),
          headers: { 'content-type': 'application/octet-stream' },
        };
      },
      async remove(slot) {
        await call(removeEvidenceUpload, { params: { token, slot } });
      },
    }),
    [token],
  );
  const uploader = useUploader(ask.data?.uploads.enabled ? target : null);
  const waiting = uploader.kept.some((i) => IN_FLIGHT.has(i.status));
  const { merge } = uploader;

  // Asked again every two seconds while a file is still being prepared.
  const statuses = useQuery({
    queryKey: ['evidence', token, 'files'],
    queryFn: ({ signal }) => call(getEvidenceUploads, { params: { token }, signal }),
    enabled: waiting,
    refetchInterval: 2000,
  });
  useEffect(() => {
    if (statuses.data) merge(statuses.data.files);
  }, [statuses.data, merge]);

  const send = useMutation({ mutationFn: () => call(sendEvidence, { params: { token } }) });

  if (ask.isPending) {
    return (
      <Narrow>
        <p role="status" className="muted">
          Opening this request…
        </p>
      </Narrow>
    );
  }
  if (ask.isError) {
    return (
      <TokenPage title="This link is not open">
        <p>{ask.error.message}</p>
      </TokenPage>
    );
  }
  const a = ask.data;
  if (send.isSuccess) {
    return (
      <TokenPage title="Thank you">
        <p className="m">{send.data.public_ref}</p>
        <Note title={`Your files are part of report ${send.data.public_ref}.`}>
          {send.data.attached === 1
            ? 'One file was added'
            : `${String(send.data.attached)} files were added`}{' '}
          as a new version of your report. Nothing you wrote was changed. A moderator looks at every
          file before anything is shown.
        </Note>
      </TokenPage>
    );
  }
  const ready = uploader.kept.filter((i) => i.status === 'clean').length;
  const preparing = uploader.kept.filter((i) => IN_FLIGHT.has(i.status)).length;
  // Pressable only when there is something to send and every file is Ready.
  const canSend = ready > 0 && !waiting;
  return (
    <TokenPage title="A moderator asked for evidence">
      {a.public_ref ? <p className="m">{a.public_ref}</p> : null}
      <p>{`About your report to “${a.logbook_title}”.`}</p>
      <Panel variant="quiet" title="What they asked">
        <p className="whitespace-pre-wrap">{a.message}</p>
      </Panel>
      <p className="m">
        This link works once, until {new Date(a.expires_at).toLocaleString()}. You do not have to
        answer.
      </p>
      {/* Where they land, the way out of being asked at all. Words, not a
          link: on a site behind its password "My reports" is behind it too,
          and this page is a door that may call nothing else. */}
      <p className="m">
        To stop being asked for evidence about this report, sign in to “My reports” with the email
        address you filed from and switch off “{PERMISSION_WORDS.evidence_request.label}”. That also
        closes this link.
      </p>
      {a.uploads.enabled ? (
        <>
          {/* The picker's box is named by this heading: without it, a
              screen reader announces an unnamed file control. */}
          <h2 id="evidence-files-heading" style={{ fontFamily: 'var(--rl-font-display)' }}>
            Send what you have
          </h2>
          <FilePicker
            config={a.uploads}
            uploader={uploader}
            labelledBy="evidence-files-heading"
            filing={false}
          />
          {send.isError ? (
            <Note warn title="Nothing was sent.">
              {send.error.message}
            </Note>
          ) : null}
          <div>
            <button
              className="btn sm flat go"
              type="button"
              disabled={!canSend || send.isPending}
              aria-describedby="evidence-send-why"
              onClick={() => {
                send.mutate();
              }}
            >
              {send.isPending ? 'Sending…' : 'Send these files'}
            </button>
            <p id="evidence-send-why" role="status" className="m">
              {preparing
                ? preparing === 1
                  ? 'One file is still being prepared. Send works once it says Ready.'
                  : `${String(preparing)} files are still being prepared. Send works once each says Ready.`
                : ready
                  ? null
                  : 'Choose a file first.'}
            </p>
          </div>
        </>
      ) : (
        <Note title="Files cannot be taken at the moment.">
          This site is not taking files right now. Please try the link again later.
        </Note>
      )}
    </TokenPage>
  );
}
