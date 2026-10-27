/**
 * The Look screen's second half, the owner's: the header background, motion
 * and section grounds (docs/ui-mockup/site/look.html, sections 2 to 4).
 * Drawn behind headlines and section bands; never behind form questions or
 * report text.
 *
 * Owner only, because it is the page every visitor sees first and one
 * person answers for it. An administrator who is not the owner sees what is
 * set, in words, and who to ask.
 *
 * SAVED TO THE SERVER, not this browser: the choices are site settings
 * (PUT /api/admin/site/look-options). The picture goes up at once, scaled
 * to 1600 px first, because a file cannot wait in a draft; everything else
 * waits for Save.
 *
 * THE DRAFT IS SHARED. `LookOptionsProvider` holds it and offers it to the
 * panel below and to the preview frames (through a portal, which keeps
 * context), so the frames draw what is being edited before it is saved.
 */
import {
  ApiError,
  removeHeaderImage,
  setLookOptions,
  uploadHeaderImage,
} from '@reportlog/contracts';
import type { LookOptions, SiteEditor } from '@reportlog/contracts';
import { useMutation } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { useSite } from '@/components/ui/site.tsx';
import { ApiRequestError, call, pathFor } from '@/lib/api.ts';
import { useMe } from '../identity/session.ts';
import { HeaderBackgroundEditor } from './header-background/HeaderBackgroundEditor.tsx';
import { downscaleToJpeg } from './header-background/image.ts';
import { useKit } from './header-background/kits.ts';
import type { Kit } from './header-background/scene.ts';
import { PreviewOptionsContext } from './previewOptions.tsx';

const same = (a: LookOptions, b: LookOptions) => JSON.stringify(a) === JSON.stringify(b);

/** The picture itself is the body, so this is the one call that does not go through `call`. */
async function sendImage(blob: Blob): Promise<SiteEditor> {
  const res = await fetch(pathFor(uploadHeaderImage.path, undefined), {
    method: uploadHeaderImage.method,
    headers: { 'content-type': blob.type || 'application/octet-stream' },
    body: blob,
    credentials: 'same-origin',
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiError.safeParse(json);
    throw err.success
      ? new ApiRequestError(res.status, err.data.error.code, err.data.error.message)
      : new ApiRequestError(res.status, 'unknown', `The server answered ${String(res.status)}.`);
  }
  return uploadHeaderImage.response.parse(json);
}

interface Draft {
  stored: LookOptions;
  draft: LookOptions;
  setDraft: (next: LookOptions) => void;
  dirty: boolean;
  kit: Kit;
  message: string | undefined;
  save: ReturnType<typeof useMutation<SiteEditor, Error, LookOptions>>;
  upload: ReturnType<typeof useMutation<SiteEditor, Error, File>>;
  remove: ReturnType<typeof useMutation<SiteEditor, Error, void>>;
  setMessage: (m: string | undefined) => void;
  reset: () => void;
}

const DraftContext = createContext<Draft | null>(null);

/**
 * Holds the draft for the screen. `onEditor` is how the screen's own copy of
 * the editor state is replaced by a server answer.
 */
export function LookOptionsProvider({
  state,
  onEditor,
  children,
}: {
  state: SiteEditor;
  onEditor: (next: SiteEditor) => void;
  children: ReactNode;
}) {
  const site = useSite();
  const stored = state.look_options;
  const [draft, setDraft] = useState<LookOptions>(stored);
  const [message, setMessage] = useState<string | undefined>();
  const { kit } = useKit(site.data?.look.kits);

  // The server's answer is the truth: after a save or an upload the draft
  // starts again from it (the picture's file name especially).
  const taken = (next: SiteEditor) => {
    onEditor(next);
    return next.look_options;
  };

  const save = useMutation({
    mutationFn: (value: LookOptions) => call(setLookOptions, { body: value }),
    onSuccess: (next) => {
      setDraft(taken(next));
    },
  });
  const upload = useMutation({
    mutationFn: async (file: File) => sendImage(await downscaleToJpeg(file)),
    onSuccess: (next) => {
      const fresh = taken(next);
      // Keep the unsaved choices; take only the picture from the server.
      setDraft((d) => ({ ...d, header: { ...d.header, image: fresh.header.image } }));
      setMessage('Image added.');
    },
    onError: (e) => {
      setMessage(e.message);
    },
  });
  const remove = useMutation({
    mutationFn: () => call(removeHeaderImage),
    onSuccess: (next) => {
      const fresh = taken(next);
      setDraft((d) => ({ ...d, header: { ...d.header, image: fresh.header.image } }));
      setMessage('Image removed.');
    },
    onError: (e) => {
      setMessage(e.message);
    },
  });

  const dirty = !same(draft, stored);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);

  const value = useMemo<Draft>(
    () => ({
      stored,
      draft,
      setDraft,
      dirty,
      kit,
      message,
      save,
      upload,
      remove,
      setMessage,
      reset: () => {
        setDraft(stored);
        save.reset();
      },
    }),
    [stored, draft, dirty, kit, message, save, upload, remove],
  );
  const preview = useMemo(() => ({ options: draft, kit }), [draft, kit]);

  return (
    <DraftContext.Provider value={value}>
      <PreviewOptionsContext.Provider value={preview}>{children}</PreviewOptionsContext.Provider>
    </DraftContext.Provider>
  );
}

export function LookOptionsPanel() {
  const me = useMe().data;
  const d = useContext(DraftContext);
  if (!d) return null;
  const isOwner = me?.signedIn === true && me.roles.includes('owner');
  if (!isOwner) {
    return (
      <section className="settings-row" aria-labelledby="look-options">
        <h2 id="look-options">Header background, motion and grounds</h2>
        <p className="muted">
          Only the owner can change these. Right now sections{' '}
          {d.stored.zones === 'alternate' ? 'alternate' : 'keep one ground'}, and decoration{' '}
          {d.stored.motion === 'on' ? 'drifts as the page scrolls' : 'stays still'}.
        </p>
      </section>
    );
  }
  const { draft, setDraft, dirty, kit, message, save, upload, remove } = d;
  return (
    <>
      <section className="settings-row" aria-labelledby="look-bg">
        <h2 id="look-bg">Header background</h2>
        <p className="muted">
          Drawn behind headlines and section bands. Never behind form questions or report text. The
          same controls are in the page editor.
        </p>
        <div style={{ maxWidth: 560 }}>
          <HeaderBackgroundEditor
            header={draft.header}
            onChange={(header) => {
              setDraft({ ...draft, header });
            }}
            kit={kit}
            onPickImage={(file) => {
              d.setMessage(undefined);
              upload.mutate(file);
            }}
            onRemoveImage={() => {
              d.setMessage(undefined);
              remove.mutate();
            }}
            imageMessage={message}
            busy={upload.isPending || remove.isPending}
          />
        </div>
      </section>

      <section className="settings-row" aria-labelledby="look-motion">
        <h2 id="look-motion">Motion</h2>
        <p className="muted">
          Decoration layers drift at different speeds as the page scrolls. Visitors whose device
          asks for reduced motion never see it, whatever this is set to.
        </p>
        <div className="seg" role="group" aria-labelledby="look-motion">
          {(
            [
              ['on', 'Parallax'],
              ['off', 'Still'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={draft.motion === value}
              onClick={() => {
                setDraft({ ...draft, motion: value });
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-row" aria-labelledby="look-zones">
        <h2 id="look-zones">Section grounds</h2>
        <p className="muted">
          Alternate dark and light bands on the front page and Get involved, or keep one ground
          throughout.
        </p>
        <div className="seg" role="group" aria-labelledby="look-zones">
          {(
            [
              ['alternate', 'Alternate'],
              ['single', 'One ground'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={draft.zones === value}
              onClick={() => {
                setDraft({ ...draft, zones: value });
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <div className="acts">
        <Btn
          look="ink"
          sm
          flat
          busy={save.isPending}
          busyLabel="Saving…"
          disabled={!dirty}
          onClick={() => {
            save.mutate(draft);
          }}
        >
          Save these choices
        </Btn>
        {dirty ? (
          <Btn look="ghost" sm flat onClick={d.reset}>
            Discard changes
          </Btn>
        ) : null}
      </div>
      {save.isError ? (
        <Note tone="serious" title="That was not saved.">
          {save.error.message}
        </Note>
      ) : null}
      {save.isSuccess && !dirty ? <Note tone="done" title="Saved. The site now shows it." /> : null}
    </>
  );
}
