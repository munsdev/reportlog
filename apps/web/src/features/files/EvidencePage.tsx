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
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { Lede, Meta } from '@/components/ui/type.tsx';
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
      <SmallPage title="This link is not open">
        <p className="max-w-prose">{ask.error.message}</p>
      </SmallPage>
    );
  }
  const a = ask.data;
  if (send.isSuccess) {
    return (
      <SmallPage title="Thank you" reference={send.data.public_ref}>
        <Alert tone="done" title={`Your files are part of report ${send.data.public_ref}`}>
          {send.data.attached === 1
            ? 'One file was added'
            : `${String(send.data.attached)} files were added`}{' '}
          as a new version of your report. Nothing you wrote was changed. A moderator looks at every
          file before anything is shown.
        </Alert>
      </SmallPage>
    );
  }
  const ready = uploader.kept.filter((i) => i.status === 'clean').length;
  const preparing = uploader.kept.filter((i) => IN_FLIGHT.has(i.status)).length;
  // Pressable only when there is something to send and every file is Ready.
  const canSend = ready > 0 && !waiting;
  return (
    <SmallPage
      title="A moderator asked for evidence"
      reference={a.public_ref}
      lede={`About your report to “${a.logbook_title}”.`}
    >
      <Card variant="quiet" className="gap-2">
        <h2 className="label-face text-xs text-ink-alt">What they asked</h2>
        <p className="max-w-prose whitespace-pre-wrap">{a.message}</p>
      </Card>
      <p className="max-w-prose text-sm text-ink-alt">
        This link works once, until <Meta>{new Date(a.expires_at).toLocaleString()}</Meta>. You do
        not have to answer.
      </p>
      {/* Where they land, the way out of being asked at all. Words, not a
          link: on a site behind its password "My reports" is behind it too,
          and this page is a door that may call nothing else. */}
      <p className="max-w-prose text-sm text-ink-alt">
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
          <FilePicker
            config={a.uploads}
            uploader={uploader}
            labelledBy="evidence-files-heading"
            filing={false}
          />
          {send.isError ? (
            <Alert tone="serious" title="Nothing was sent">
              {send.error.message}
            </Alert>
          ) : null}
          <div className="flex flex-col items-stretch gap-2 sm:items-start">
            <Button
              type="button"
              size="lg"
              block
              className="sm:w-auto"
              disabled={!canSend}
              busy={send.isPending}
              busyLabel="Sending…"
              aria-describedby="evidence-send-why"
              onClick={() => {
                send.mutate();
              }}
            >
              Send these files
            </Button>
            <p id="evidence-send-why" role="status" className="text-sm text-ink-alt">
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
        <Alert title="Files cannot be taken at the moment">
          This site is not taking files right now. Please try the link again later.
        </Alert>
      )}
    </SmallPage>
  );
}

/**
 * The frame of a page reached from a link in an email: a heading, the
 * report's reference in mono, and nothing from the rest of the site.
 */
function SmallPage({
  title,
  reference,
  lede,
  children,
}: {
  title: string;
  reference?: string | undefined;
  lede?: string | undefined;
  children: ReactNode;
}) {
  const site = plainSiteName(useSite().data);
  useEffect(() => {
    document.title = `${title} · ${site}`;
  }, [title, site]);
  return (
    <section className="mx-auto flex w-full max-w-[40rem] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-title">{title}</h1>
        {reference ? <Meta className="text-base text-ink">{reference}</Meta> : null}
        {lede ? <Lede>{lede}</Lede> : null}
      </div>
      {children}
    </section>
  );
}
