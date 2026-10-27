/**
 * The upload question's card, and the list of files on it.
 *
 * Said before anybody picks a file: what happens to camera details and
 * location (they are removed from any copy that could be shown, and kept
 * with the original as evidence), and that nothing is filed until the
 * reporter confirms from their email.
 */
import { DRAFT_HEADER, FILE_PATHS, createUpload, newUploadDraft } from '@reportlog/contracts';
import type { UploadConfig } from '@reportlog/contracts';
import { useId, useMemo, useRef, useState } from 'react';
import { Btn } from '@/mockup/Btn.tsx';
import { FileDrop } from '@/mockup/FileDrop.tsx';
import { call } from '@/lib/api.ts';
import { megabytes, refusalFor } from './uploader.ts';
import type { Item, Target, Uploader } from './uploader.ts';

/** Where a filing form's files go: a draft made the first time one is picked. */
export function useFilingTarget(
  slug: string,
  email: string,
): Target & { draft: () => string | null } {
  const draft = useRef<string | null>(null);
  return useMemo(() => {
    const ensure = async () => {
      draft.current ??= (await call(newUploadDraft)).draft_token;
      return draft.current;
    };
    return {
      draft: () => draft.current,
      async create(file) {
        const token = await ensure();
        const out = await call(createUpload, {
          body: { draft_token: token, logbook: slug, email: email.trim(), ...file },
        });
        return out.slot_token;
      },
      put(slot) {
        return {
          url: FILE_PATHS.upload(slot),
          headers: {
            'content-type': 'application/octet-stream',
            [DRAFT_HEADER]: draft.current ?? '',
          },
        };
      },
      async remove(slot) {
        const res = await fetch(FILE_PATHS.upload(slot), {
          method: 'DELETE',
          headers: { [DRAFT_HEADER]: draft.current ?? '' },
          credentials: 'same-origin',
        });
        if (!res.ok && res.status !== 404)
          throw new Error('That file could not be removed. Try again.');
      },
    };
  }, [slug, email]);
}

/**
 * Each file's line while it is on its way: "Uploading, 40%", "Uploaded",
 * then "Preparing" while the server checks and re-encodes it, then "Ready".
 * On the filing form a file stops at "Uploaded": it is prepared only once
 * the report is sent (files/slots.ts, releaseDraft), so "Preparing" there
 * would say something is happening that is not. The evidence page and the
 * coordinator's accounts go on to Ready. The rest say what went wrong in a
 * word; the reason, when there is one, follows.
 */
const STATUS: Record<string, string> = {
  uploaded: 'Uploaded',
  pending: 'Preparing',
  processing: 'Preparing',
  clean: 'Ready',
  rejected: 'Not accepted',
  unreadable: 'Could not be read',
  infected: 'Not accepted',
  failed: 'Not sent',
  expired: 'Expired',
};

export function statusWords(i: Pick<Item, 'status' | 'progress'>): string {
  if (i.status === 'uploading') return `Uploading, ${String(i.progress)}%`;
  return STATUS[i.status] ?? i.status;
}

export function FileList({
  items,
  onRemove,
}: {
  items: readonly Item[];
  onRemove: (i: Item) => void;
}) {
  if (!items.length) return null;
  return (
    <div style={{ display: 'grid', gap: 12 }} role="list" aria-label="Your files">
      {items.map((i) => (
        <div className="filerow" role="listitem" key={i.id}>
          <span className="fic" aria-hidden="true">
            {(i.name.split('.').pop() ?? '').slice(0, 4).toUpperCase()}
          </span>
          <div>
            <b style={{ overflowWrap: 'anywhere' }}>{i.name}</b>
            <p className="m">
              {megabytes(i.size)} · <span data-status={i.status}>{statusWords(i)}</span>
            </p>
            {i.status === 'uploading' ? (
              <div
                className="progress"
                role="progressbar"
                aria-label={`Sending ${i.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={i.progress}
              >
                <span style={{ width: `${String(i.progress)}%` }} />
              </div>
            ) : null}
            {i.error ? <p className="error">{i.error}</p> : null}
            <div className="acts">
              <Btn
                sm
                flat
                look="ghost"
                onClick={() => {
                  onRemove(i);
                }}
                aria-label={`Remove ${i.name}`}
              >
                Remove
              </Btn>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A file picker with the limits said in words, and the files picked so far. */
export function FilePicker({
  config,
  uploader,
  labelledBy,
  filing = true,
}: {
  config: UploadConfig;
  uploader: Uploader;
  labelledBy?: string;
  /**
   * On a report being filed, which waits for the reporter's email. False for
   * files sent in answer to a request, which are added when they are sent.
   */
  filing?: boolean;
}) {
  const id = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const room = uploader.kept.length < config.max_files;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p className="m" id={`${id}-limits`}>
        {config.max_files === 1 ? 'One file' : `Up to ${String(config.max_files)} files`}, together
        less than {megabytes(config.max_total_bytes)}.{' '}
        {config.kinds.includes('video') || config.kinds.includes('audio')
          ? `Video and sound up to ${config.max_video_seconds < 90 ? `${String(config.max_video_seconds)} seconds` : `${String(Math.round(config.max_video_seconds / 60))} minutes`}.`
          : null}
      </p>
      <p className="m">
        Photos and videos carry hidden details: where they were taken, when, and on what. Those are
        removed from any copy that could ever be shown. The file as you send it is kept, locked, as
        evidence.{filing ? ' Nothing is filed until you confirm from your email.' : null}
      </p>
      <FileDrop
        multiple={config.max_files > 1}
        accept={config.accept.join(',')}
        labelledBy={labelledBy}
        describedBy={`${id}-limits`}
        disabled={!room}
        buttonLabel={uploader.kept.length ? 'Add another file' : 'Choose files'}
        onFiles={(files) => {
          setProblem(null);
          const kept = [...uploader.kept];
          for (const f of files) {
            const why = refusalFor(f, config, kept);
            if (why) {
              setProblem(why);
              continue;
            }
            kept.push({
              id: 0,
              name: f.name,
              size: f.size,
              slot: null,
              status: 'uploading',
              progress: 0,
              error: null,
            });
            void uploader.add(f);
          }
        }}
      />
      {problem ? (
        <p role="alert" className="error">
          {problem}
        </p>
      ) : null}
      <FileList
        items={uploader.items}
        onRemove={(i) => {
          void uploader.remove(i);
        }}
      />
    </div>
  );
}
