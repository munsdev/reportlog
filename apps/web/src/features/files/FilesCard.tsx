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
import { Button } from '@/components/ui/button.tsx';
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

const STATUS: Record<string, string> = {
  uploading: 'Sending',
  uploaded: 'Sent',
  pending: 'Waiting',
  processing: 'Being prepared',
  clean: 'Ready',
  rejected: 'Not accepted',
  unreadable: 'Could not be read',
  infected: 'Not accepted',
  failed: 'Not sent',
  expired: 'Expired',
};

export function FileList({
  items,
  onRemove,
}: {
  items: readonly Item[];
  onRemove: (i: Item) => void;
}) {
  if (!items.length) return null;
  return (
    <ul
      className="flex flex-col divide-y divide-line rounded-card border border-line"
      aria-label="Your files"
    >
      {items.map((i) => (
        <li key={i.id} className="flex flex-col gap-1 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="break-all font-semibold">{i.name}</span>
            <Button
              type="button"
              variant="quiet"
              size="sm"
              onClick={() => {
                onRemove(i);
              }}
              aria-label={`Remove ${i.name}`}
            >
              Remove
            </Button>
          </div>
          <span className="text-sm text-ink-alt">
            {megabytes(i.size)} · <span data-status={i.status}>{STATUS[i.status] ?? i.status}</span>
          </span>
          {i.status === 'uploading' ? (
            <div
              role="progressbar"
              aria-label={`Sending ${i.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={i.progress}
              className="h-1.5 w-full overflow-hidden rounded-full bg-paper-alt"
            >
              <div className="h-full bg-ink" style={{ width: `${String(i.progress)}%` }} />
            </div>
          ) : null}
          {i.error ? <span className="text-sm font-semibold text-serious">{i.error}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** A file picker with the limits said in words, and the files picked so far. */
export function FilePicker({
  config,
  uploader,
  labelledBy,
}: {
  config: UploadConfig;
  uploader: Uploader;
  labelledBy?: string;
}) {
  const id = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const room = uploader.kept.length < config.max_files;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-alt" id={`${id}-limits`}>
        {config.max_files === 1 ? 'One file' : `Up to ${String(config.max_files)} files`}, together
        less than {megabytes(config.max_total_bytes)}.{' '}
        {config.kinds.includes('video') || config.kinds.includes('audio')
          ? `Video and sound up to ${config.max_video_seconds < 90 ? `${String(config.max_video_seconds)} seconds` : `${String(Math.round(config.max_video_seconds / 60))} minutes`}.`
          : null}
      </p>
      <p className="text-sm">
        Photos and videos carry hidden details: where they were taken, when, and on what. Those are
        removed from any copy that could ever be shown. The file as you send it is kept, locked, as
        evidence. Nothing is filed until you confirm from your email.
      </p>
      <input
        ref={input}
        id={`${id}-input`}
        type="file"
        className="sr-only"
        multiple={config.max_files > 1}
        accept={config.accept.join(',')}
        aria-labelledby={labelledBy}
        aria-describedby={`${id}-limits`}
        onChange={(e) => {
          setProblem(null);
          const kept = [...uploader.kept];
          for (const f of Array.from(e.target.files ?? [])) {
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
          e.target.value = '';
        }}
      />
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={!room}
          onClick={() => input.current?.click()}
        >
          {uploader.kept.length ? 'Add another file' : 'Choose files'}
        </Button>
      </div>
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-serious">
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
