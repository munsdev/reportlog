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
import { Note } from '@/mockup/Note.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { FileDrop } from '@/mockup/FileDrop.tsx';
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
    <section aria-labelledby={headingId} className="form-stack" style={{ maxWidth: 'none' }}>
      <h3 id={headingId}>Add looks from a file</h3>
      <FileDrop
        accept=".zip,application/zip"
        buttonLabel={state.at === 'choosing' ? 'Choose a .zip' : 'Choose another .zip'}
        labelledBy={headingId}
        disabled={state.at === 'checking' || state.at === 'installing'}
        limits="A look pack is a .zip with a look.json and its fonts. Every colour is checked before anything is installed."
        onFiles={(files) => void choose(files[0])}
      />

      {state.at === 'checking' ? (
        <p role="status" className="muted">
          Checking {state.name}…
        </p>
      ) : null}

      {state.at === 'refused' ? (
        <Note tone="serious" title={`${state.name} cannot be installed`}>
          <p>Nothing was installed. The check found:</p>
          {groupProblems(state.problems).map((g) => (
            <div key={g.title}>
              <p>
                <b>{g.title}</b>
              </p>
              <ul>
                {g.items.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </Note>
      ) : null}

      {state.at === 'failed' ? <Note tone="serious" title={state.message} /> : null}

      {state.at === 'ready' || state.at === 'installing' ? (
        <div className="form-stack" style={{ maxWidth: 'none' }}>
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
          {state.error ? <Note tone="serious" title={state.error} /> : null}
          <div className="acts">
            <Btn
              look="ink"
              sm
              flat
              busy={state.at === 'installing'}
              busyLabel="Installing…"
              onClick={() => void install()}
            >
              {state.replaces ? `Replace version ${state.replaces}` : 'Install'}
            </Btn>
          </div>
        </div>
      ) : null}

      {state.at === 'installed' ? (
        <Note tone="done" title={`${state.pack.label} ${state.pack.version} is installed.`}>
          {state.replaced ? `It replaced version ${state.replaced}. ` : ''}
          Its looks are offered on this screen now. The site is not wearing them until you choose
          one and apply it.
        </Note>
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
    <div className="form-stack" style={{ maxWidth: 'none' }}>
      {pack.looks.length ? (
        <div className="packrow" aria-label="Looks" role="list">
          {pack.looks.map((l) => (
            <div key={l.id} role="listitem">
              <b>{l.label}</b>
              <p>
                {palette(l.palette)?.label ?? l.palette} with {theme(l.theme)?.label ?? l.theme}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      <dl className="dl">
        {pack.palettes.length ? (
          <div>
            <dt>Palettes</dt>
            <dd>
              {pack.palettes.map((p) => `${p.label} (${p.dark ? 'dark' : 'light'})`).join(', ')}
            </dd>
          </div>
        ) : null}
        {pack.themes.length ? (
          <div>
            <dt>Themes</dt>
            <dd>{pack.themes.map((t) => t.label).join(', ')}</dd>
          </div>
        ) : null}
        {pack.fonts.length ? (
          <div>
            <dt>Fonts</dt>
            <dd>{pack.fonts.join(', ')}</dd>
          </div>
        ) : null}
        {pack.author ? (
          <div>
            <dt>By</dt>
            <dd>{pack.author}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
