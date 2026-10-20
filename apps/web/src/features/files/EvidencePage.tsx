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
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Page } from '@/components/ui/page.tsx';
import { PERMISSION_WORDS } from '@/features/form/permissionWords.ts';
import { call } from '@/lib/api.ts';
import { FilePicker } from './FilesCard.tsx';
import { useUploader } from './uploader.ts';
import type { Target } from './uploader.ts';

const IN_FLIGHT = new Set(['uploading', 'uploaded', 'pending', 'processing']);

export function EvidencePage({ token }: { token: string }) {
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

  if (ask.isPending) return <p role="status">Opening this request…</p>;
  if (ask.isError) {
    return (
      <Page title="This link is not open" width="prose">
        <p>{ask.error.message}</p>
      </Page>
    );
  }
  const a = ask.data;
  if (send.isSuccess) {
    return (
      <Page title="Thank you" width="prose">
        <Alert tone="confirmed" title={`Your files are part of report ${send.data.public_ref}`}>
          {send.data.attached === 1
            ? 'One file was added'
            : `${String(send.data.attached)} files were added`}{' '}
          as a new version of your report. Nothing you wrote was changed. A moderator looks at every
          file before anything is shown.
        </Alert>
      </Page>
    );
  }
  const ready = uploader.kept.filter((i) => i.status === 'clean').length;
  return (
    <Page
      title="A request about your report"
      width="prose"
      lede={`Your report ${a.public_ref}, to “${a.logbook_title}”.`}
    >
      <p>Somebody reviewing your report asked:</p>
      <blockquote className="whitespace-pre-wrap rounded-card border-l-4 border-line bg-paper-alt p-4">
        {a.message}
      </blockquote>
      <p className="text-sm text-ink-alt">
        This link works once, until {new Date(a.expires_at).toLocaleString()}. You do not have to
        answer.
      </p>
      {/* Where they land, the way out of being asked at all. Words, not a
          link: on a site behind its password "My reports" is behind it too,
          and this page is a door that may call nothing else. */}
      <p className="text-sm text-ink-alt">
        To stop being asked for evidence about this report, sign in to “My reports” with the email
        address you filed from and switch off “{PERMISSION_WORDS.evidence_request.label}”. That also
        closes this link.
      </p>
      {a.uploads.enabled ? (
        <>
          {/* The picker's box is named by this heading: without it, a
              screen reader announces an unnamed file control. */}
          <h2 id="evidence-files-heading" className="font-display text-xl font-bold">
            Send what you have
          </h2>
          <FilePicker config={a.uploads} uploader={uploader} labelledBy="evidence-files-heading" />
          {send.isError ? (
            <Alert tone="serious" title="Nothing was sent">
              {send.error.message}
            </Alert>
          ) : null}
          <div>
            <Button
              type="button"
              disabled={!ready || waiting || send.isPending}
              onClick={() => {
                send.mutate();
              }}
            >
              {send.isPending
                ? 'Sending…'
                : waiting
                  ? 'Your files are being prepared…'
                  : 'Send these files'}
            </Button>
          </div>
        </>
      ) : (
        <Alert title="Files cannot be taken at the moment">
          This site is not taking files right now. Please try the link again later.
        </Alert>
      )}
    </Page>
  );
}
