/**
 * Sending files: one small state machine for the filing form and the
 * evidence page alike.
 *
 * Files go to the site's own origin, byte for byte, and nowhere else: the
 * server encrypts them as they arrive. A file is uploaded the moment it is
 * picked, so the wait happens while somebody reads the next card, not after
 * they press Send.
 *
 * WHAT THE PAGE CHECKS IS ONLY A KINDNESS. It saves somebody a failed upload
 * by checking the limits the server sent; the server checks them all again
 * and decides.
 */
import { ApiError } from '@reportlog/contracts';
import type { UploadConfig } from '@reportlog/contracts';
import { useCallback, useRef, useState } from 'react';

export type ItemStatus = 'uploading' | 'uploaded' | 'failed' | (string & {});

export interface Item {
  id: number;
  name: string;
  size: number;
  slot: string | null;
  status: ItemStatus;
  /** 0–100 while uploading. */
  progress: number;
  error: string | null;
}

/** Where one kind of upload goes: a filing draft, or an evidence request. */
export interface Target {
  /** Reserve a place for a file; resolves to its slot token. */
  create(file: { name: string; type: string; size: number }): Promise<string>;
  /** The URL and headers the bytes are PUT with. */
  put(slot: string): { url: string; headers: Record<string, string> };
  remove(slot: string): Promise<void>;
}

export function kindOf(type: string, config: UploadConfig): keyof UploadConfig['max_bytes'] | null {
  if (!config.accept.includes(type)) return null;
  if (type.startsWith('image/')) return 'photo';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'document';
}

export function megabytes(n: number): string {
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${String(Math.max(1, Math.round(n / 1024)))} KB`;
}

/** What is wrong with adding this file, in a sentence, or null. */
export function refusalFor(
  file: { name: string; type: string; size: number },
  config: UploadConfig,
  kept: readonly Item[],
): string | null {
  const kind = kindOf(file.type, config);
  if (!kind) return `“${file.name}” is not a kind of file this form takes.`;
  const max = config.max_bytes[kind];
  if (file.size > max)
    return `“${file.name}” is larger than ${megabytes(max)}, the most this form takes for one.`;
  if (kept.length >= config.max_files) {
    return config.max_files === 1
      ? 'This form takes one file. Remove the one attached to choose a different one.'
      : `This form takes at most ${String(config.max_files)} files.`;
  }
  const total = kept.reduce((n, i) => n + i.size, 0) + file.size;
  if (total > config.max_total_bytes) {
    return `Together the files must come to less than ${megabytes(config.max_total_bytes)}.`;
  }
  return null;
}

async function errorOf(text: string, status: number): Promise<string> {
  try {
    const parsed = ApiError.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data.error.message;
  } catch {
    // not JSON
  }
  return Promise.resolve(`The server answered ${String(status)}.`);
}

/** PUT the bytes with progress (fetch cannot report upload progress). */
function send(
  url: string,
  headers: Record<string, string>,
  file: Blob,
  onProgress: (pct: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else
        void errorOf(xhr.responseText, xhr.status).then((m) => {
          reject(new Error(m));
        });
    };
    xhr.onerror = () => {
      reject(new Error('The connection dropped while sending. Try that file again.'));
    };
    xhr.send(file);
  });
}

export function useUploader(target: Target | null) {
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(1);
  const patch = useCallback((id: number, p: Partial<Item>) => {
    setItems((all) => all.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }, []);

  const add = useCallback(
    async (file: File) => {
      if (!target) return;
      const id = next.current++;
      setItems((all) => [
        ...all,
        {
          id,
          name: file.name,
          size: file.size,
          slot: null,
          status: 'uploading',
          progress: 0,
          error: null,
        },
      ]);
      try {
        const slot = await target.create({ name: file.name, type: file.type, size: file.size });
        patch(id, { slot });
        const { url, headers } = target.put(slot);
        await send(url, headers, file, (progress) => {
          patch(id, { progress });
        });
        patch(id, { status: 'uploaded', progress: 100 });
      } catch (e) {
        patch(id, { status: 'failed', error: (e as Error).message });
      }
    },
    [target, patch],
  );

  const remove = useCallback(
    async (item: Item) => {
      if (target && item.slot && item.status !== 'failed') {
        try {
          await target.remove(item.slot);
        } catch (e) {
          patch(item.id, { error: (e as Error).message });
          return;
        }
      }
      setItems((all) => all.filter((i) => i.id !== item.id));
    },
    [target, patch],
  );

  /** Fold in what the server says each file has become (the evidence page polls). */
  const merge = useCallback(
    (statuses: readonly { slot_token: string; status: string; detail: string | null }[]) => {
      setItems((all) =>
        all.map((i) => {
          const s = statuses.find((x) => x.slot_token === i.slot);
          return s && i.status !== 'uploading' ? { ...i, status: s.status, error: s.detail } : i;
        }),
      );
    },
    [],
  );

  return {
    items,
    /** Files that are on their way or arrived; failed ones are only shown. */
    kept: items.filter((i) => i.status !== 'failed'),
    busy: items.some((i) => i.status === 'uploading'),
    add,
    remove,
    merge,
  };
}
export type Uploader = ReturnType<typeof useUploader>;
