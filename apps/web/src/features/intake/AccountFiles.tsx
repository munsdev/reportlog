/**
 * The upload question in the account dialog: what the person a coordinator
 * spoke to handed over, attached to the account itself.
 *
 * The files workstream's uploader, file list and limit checks, unchanged
 * (features/files/). Its picker is not used as it is, only because its last
 * sentence tells a REPORTER that nothing is filed until they confirm from
 * their email, which is not true here. Only where the bytes go differs: to the account's own routes, which ask
 * whether the account is this coordinator's, instead of a reporter's free
 * draft. The server starts preparing each file as soon as it arrives, and
 * the batch's "Before filing" says which are not ready yet.
 *
 * What the server holds is what is shown, once a file has arrived. A file
 * still on its way is the uploader's until then, so nothing on screen jumps
 * between the two.
 */
import {
  INTAKE_FILE_PATH,
  addIntakeDraftFile,
  getUploadConfig,
  listIntakeDraftFiles,
  removeIntakeDraftFile,
} from '@reportlog/contracts';
import type { FormQuestion, UploadConfig } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { FileDrop } from '@/components/ui/file-drop.tsx';
import { FileList } from '@/features/files/FilesCard.tsx';
import { megabytes, refusalFor, useUploader } from '@/features/files/uploader.ts';
import type { Item, Target } from '@/features/files/uploader.ts';
import { call } from '@/lib/api.ts';

const BEING_WORKED_ON = new Set(['uploaded', 'processing']);

export function AccountFiles({
  draftId,
  logbook,
  question,
  onBusy,
}: {
  draftId: number;
  /** The logbook chosen in the dialog, saved or not: its limits apply. */
  logbook: string;
  question: FormQuestion;
  /** Told whether a file is still being sent, so the dialog does not close on it. */
  onBusy: (busy: boolean) => void;
}) {
  const headingId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const config = useQuery({
    queryKey: ['intake', 'upload-config', logbook],
    queryFn: ({ signal }) => call(getUploadConfig, { query: { logbook }, signal }),
  });
  const held = useQuery({
    queryKey: ['intake', 'drafts', draftId, 'files'],
    queryFn: ({ signal }) => call(listIntakeDraftFiles, { params: { id: draftId }, signal }),
    // While the server is preparing a file, look again now and then, so
    // "Being prepared" becomes "Ready" without anybody reloading.
    refetchInterval: (q) =>
      q.state.data?.files.some((f) => BEING_WORKED_ON.has(f.status)) ? 3000 : false,
  });

  const target = useMemo<Target>(
    () => ({
      async create(file) {
        const out = await call(addIntakeDraftFile, {
          params: { id: draftId },
          body: { logbook, ...file },
        });
        return out.slot_token;
      },
      put(slot) {
        return {
          url: INTAKE_FILE_PATH(draftId, slot),
          headers: { 'content-type': 'application/octet-stream' },
        };
      },
      async remove(slot) {
        await call(removeIntakeDraftFile, { params: { id: draftId, slot } });
      },
    }),
    [draftId, logbook],
  );
  const uploader = useUploader(target);

  // A file that has arrived is the server's to describe from now on.
  const arrived = uploader.items.filter((i) => i.status === 'uploaded').length;
  const { refetch } = held;
  useEffect(() => {
    if (arrived) void refetch();
  }, [arrived, refetch]);
  useEffect(() => {
    onBusy(uploader.busy);
  }, [uploader.busy, onBusy]);

  const fromServer: Item[] = (held.data?.files ?? []).map((f, n) => ({
    id: -(n + 1),
    name: f.name,
    size: f.size,
    slot: f.slot_token,
    status: f.status,
    progress: 100,
    error: f.detail,
  }));
  const known = new Set(fromServer.map((i) => i.slot));
  const items = [...fromServer, ...uploader.items.filter((i) => !i.slot || !known.has(i.slot))];
  const remove = async (item: Item) => {
    setProblem(null);
    if (item.id > 0) {
      await uploader.remove(item);
    } else if (item.slot) {
      try {
        await target.remove(item.slot);
      } catch (e) {
        setProblem((e as Error).message);
        return;
      }
    }
    await refetch();
  };

  return (
    <div className="flex flex-col gap-2">
      <p id={headingId} className="font-semibold">
        {question.label}
        {question.required ? '' : ' (optional)'}
      </p>
      {question.help ? <p className="text-sm text-ink-alt">{question.help}</p> : null}
      {config.data?.enabled ? (
        <Picker
          config={config.data}
          kept={items.filter((i) => i.status !== 'failed')}
          labelledBy={headingId}
          onPick={(f) => {
            void uploader.add(f);
          }}
          onRefused={setProblem}
        />
      ) : config.data ? (
        <p className="text-sm">
          This site is not taking files at the moment, so the account is filed without them.
        </p>
      ) : (
        <p role="status" className="text-sm">
          Loading…
        </p>
      )}
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-serious">
          {problem}
        </p>
      ) : null}
      <FileList items={items} onRemove={(i) => void remove(i)} />
    </div>
  );
}

/** The limits in words, and a button. What the page checks is only a kindness. */
function Picker({
  config,
  kept,
  labelledBy,
  onPick,
  onRefused,
}: {
  config: UploadConfig;
  kept: readonly Item[];
  labelledBy: string;
  onPick: (file: File) => void;
  onRefused: (why: string | null) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-alt" id={`${id}-limits`}>
        {config.max_files === 1 ? 'One file' : `Up to ${String(config.max_files)} files`}, together
        less than {megabytes(config.max_total_bytes)}.
      </p>
      <p className="text-sm">
        Hidden details in photos and videos (where, when, on what) are removed from any copy that
        could ever be shown. The file as you attach it is kept, locked, as evidence. It is filed
        with the account, when you file the batch.
      </p>
      <FileDrop
        multiple={config.max_files > 1}
        accept={config.accept.join(',')}
        labelledBy={labelledBy}
        describedBy={`${id}-limits`}
        disabled={kept.length >= config.max_files}
        buttonLabel={kept.length ? 'Add another file' : 'Choose files'}
        onFiles={(files) => {
          onRefused(null);
          const counted = [...kept];
          for (const f of files) {
            const why = refusalFor(f, config, counted);
            if (why) {
              onRefused(why);
              continue;
            }
            counted.push({ ...EMPTY, name: f.name, size: f.size });
            onPick(f);
          }
        }}
      />
    </div>
  );
}

const EMPTY: Item = {
  id: 0,
  name: '',
  size: 0,
  slot: null,
  status: 'uploading',
  progress: 0,
  error: null,
};
