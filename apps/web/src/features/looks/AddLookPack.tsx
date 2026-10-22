/**
 * "Add looks from a file" (docs/design/screens/settings-and-admin.md, Look,
 * and docs/design/looks/README.md section 05). Owner and administrators.
 *
 *   1. Choose a .zip. The server checks it and installs nothing.
 *   2. Refused: every sentence the check returned, grouped by palette or
 *      theme. Passed: what the pack adds, its looks as cards, and Install.
 *   3. Install asks for the step-up (the API client does that, then tries
 *      once more), installs, and the site's look and the pack list reload so
 *      the new looks are offered at once.
 *
 * Self-contained: the Look screen places it in a setting panel at its foot,
 * with `InstalledLookPacks` under it.
 */
import { LOOK_PACK_MAX_ZIP_BYTES, checkLookPack, installLookPack } from '@reportlog/contracts';
import type { InstalledLookPack, LookPackSummary } from '@reportlog/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { FileDrop } from '@/components/ui/file-drop.tsx';
import { siteQuery } from '@/components/ui/site.tsx';
import { ApiRequestError, call } from '@/lib/api.ts';
import { addsWhat, fileToBase64, groupProblems, lookPacksQuery } from './queries.ts';

type State =
  | { at: 'choosing' }
  | { at: 'checking'; name: string }
  | { at: 'refused'; name: string; problems: string[] }
  | {
      at: 'ready' | 'installing';
      name: string;
      zip: string;
      pack: LookPackSummary;
      replaces: string | null;
      /** Why the last Install did not go through; the pack stays chosen. */
      error: string | null;
    }
  | { at: 'installed'; pack: InstalledLookPack; replaced: string | null }
  | { at: 'failed'; message: string };

export interface AddLookPackProps {
  /** After a pack is installed or replaced: the Look screen may want to say so in a toast. */
  onInstalled?: ((pack: InstalledLookPack, replaced: string | null) => void) | undefined;
}

const sayError = (e: unknown) =>
  e instanceof ApiRequestError ? e.message : 'Something went wrong. Try again in a moment.';

export function AddLookPack({ onInstalled }: AddLookPackProps) {
  const client = useQueryClient();
  const [state, setState] = useState<State>({ at: 'choosing' });
  const headingId = useId();

  const choose = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > LOOK_PACK_MAX_ZIP_BYTES) {
      setState({
        at: 'refused',
        name: file.name,
        problems: ['The pack is larger than 10 MB.'],
      });
      return;
    }
    setState({ at: 'checking', name: file.name });
    try {
      const zip = await fileToBase64(file);
      const answer = await call(checkLookPack, { body: { zip } });
      if (answer.problems.length || !answer.pack) {
        setState({ at: 'refused', name: file.name, problems: answer.problems });
      } else {
        setState({
          at: 'ready',
          name: file.name,
          zip,
          pack: answer.pack,
          replaces: answer.replaces,
          error: null,
        });
      }
    } catch (e) {
      setState({ at: 'failed', message: sayError(e) });
    }
  };

  const install = async () => {
    if (state.at !== 'ready') return;
    setState({ ...state, at: 'installing', error: null });
    try {
      const done = await call(installLookPack, { body: { zip: state.zip } });
      // The site's look carries every pack's stylesheet; the picker lists the packs.
      await Promise.all([
        client.invalidateQueries({ queryKey: siteQuery.queryKey }),
        client.invalidateQueries({ queryKey: lookPacksQuery.queryKey }),
      ]);
      setState({ at: 'installed', pack: done.pack, replaced: done.replaced });
      onInstalled?.(done.pack, done.replaced);
    } catch (e) {
      // A refusal at install time (another pack installed meanwhile, or the
      // step-up closed) keeps what was chosen, so Install can be pressed again.
      setState({ ...state, at: 'ready', error: sayError(e) });
    }
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h3 id={headingId} className="font-display text-lg font-bold">
        Add looks from a file
      </h3>
      <FileDrop
        accept=".zip,application/zip"
        buttonLabel={state.at === 'choosing' ? 'Choose a .zip' : 'Choose another .zip'}
        labelledBy={headingId}
        disabled={state.at === 'checking' || state.at === 'installing'}
        limits="A look pack is a .zip with a look.json and its fonts. Every colour is checked before anything is installed."
        onFiles={(files) => void choose(files[0])}
      />

      {state.at === 'checking' ? (
        <p role="status" className="text-ink-alt">
          Checking {state.name}…
        </p>
      ) : null}

      {state.at === 'refused' ? (
        <Alert tone="serious" title={`${state.name} cannot be installed`}>
          <p>Nothing was installed. The check found:</p>
          {groupProblems(state.problems).map((g) => (
            <div key={g.title} className="mt-2">
              <p className="font-semibold text-ink">{g.title}</p>
              <ul className="list-disc pl-5">
                {g.items.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </Alert>
      ) : null}

      {state.at === 'failed' ? <Alert tone="serious" title={state.message} /> : null}

      {state.at === 'ready' || state.at === 'installing' ? (
        <div className="flex flex-col gap-4">
          <p role="status">
            <strong>
              {state.pack.label} {state.pack.version}
            </strong>{' '}
            adds{' '}
            {addsWhat({
              palettes: state.pack.palettes.length,
              themes: state.pack.themes.length,
              looks: state.pack.looks.length,
            }) || 'nothing new'}
            .{state.replaces ? ` It replaces version ${state.replaces}.` : ''}
          </p>
          <PackContents pack={state.pack} />
          {state.error ? <Alert tone="serious" title={state.error} /> : null}
          <div>
            <Button
              busy={state.at === 'installing'}
              busyLabel="Installing…"
              onClick={() => void install()}
            >
              {state.replaces ? `Replace version ${state.replaces}` : 'Install'}
            </Button>
          </div>
        </div>
      ) : null}

      {state.at === 'installed' ? (
        <Alert tone="done" title={`${state.pack.label} ${state.pack.version} is installed.`}>
          {state.replaced ? `It replaced version ${state.replaced}. ` : ''}
          Its looks are offered on this screen now. The site is not wearing them until you choose
          one and apply it.
        </Alert>
      ) : null}
    </section>
  );
}

/**
 * What the pack adds: its looks as cards, then its palettes, themes and
 * fonts by name. In words only: before it is installed there is no
 * stylesheet to paint a sample with, and a component never paints a colour
 * of its own (test/ui/client-first.test.ts). Once installed, the Look
 * screen's cards and previews show each look through the pack's stylesheet.
 */
export function PackContents({ pack }: { pack: LookPackSummary }) {
  const palette = (id: string) => pack.palettes.find((p) => p.id === id);
  const theme = (id: string) => pack.themes.find((t) => t.id === id);
  return (
    <div className="flex flex-col gap-3">
      {pack.looks.length ? (
        <ul aria-label="Looks" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {pack.looks.map((l) => (
            <li
              key={l.id}
              className="flex flex-col gap-2 rounded-card border-(length:--rl-border-main) border-ink-alt bg-surface p-3"
            >
              <span className="font-semibold">{l.label}</span>
              <span className="text-sm text-ink-alt">
                {palette(l.palette)?.label ?? l.palette} with {theme(l.theme)?.label ?? l.theme}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="grid gap-1 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
        {pack.palettes.length ? (
          <>
            <dt className="label-face">Palettes</dt>
            <dd>
              {pack.palettes.map((p) => `${p.label} (${p.dark ? 'dark' : 'light'})`).join(', ')}
            </dd>
          </>
        ) : null}
        {pack.themes.length ? (
          <>
            <dt className="label-face">Themes</dt>
            <dd>{pack.themes.map((t) => t.label).join(', ')}</dd>
          </>
        ) : null}
        {pack.fonts.length ? (
          <>
            <dt className="label-face">Fonts</dt>
            <dd>{pack.fonts.join(', ')}</dd>
          </>
        ) : null}
        {pack.author ? (
          <>
            <dt className="label-face">By</dt>
            <dd>{pack.author}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
