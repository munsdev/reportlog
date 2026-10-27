/**
 * Site > Import and export. The owner downloads the site's wording, pages,
 * accounts and look as one file, or uploads one to replace them.
 *
 * Says plainly what an import replaces and what it never touches, and keeps
 * a copy of the settings it replaces: "Restore" puts them back. The server
 * asks for the second factor on an import and a restore.
 */
import {
  exportSiteBundle,
  getBundleBackup,
  importSiteBundle,
  restoreBundleBackup,
  SiteBundle,
} from '@reportlog/contracts';
import type { BundleResult } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { call } from '@/lib/api.ts';
import { Dlg } from '@/mockup/Dlg.tsx';
import { Note } from '@/mockup/Note.tsx';
import { ErrorNote, Panel } from '@/mockup/Panel.tsx';
import { SmBtn as Btn } from '@/mockup/SmBtn.tsx';

/** What the file holds, in words, for the confirm step. */
function holds(b: SiteBundle): string[] {
  const s = b.site;
  const out: string[] = [];
  if (s.name !== undefined) out.push('the site name');
  if (s.copy) out.push(`${String(Object.keys(s.copy).length)} pieces of wording`);
  if (s.legal) out.push('the legal notice and privacy policy');
  if (s.pages) out.push(`the page blocks of: ${Object.keys(s.pages).join(', ')}`);
  if (s.home_sections) out.push('the order of the front page sections');
  if (s.social) out.push('the social accounts, where they show and the Follow us button');
  if (s.look?.palette || s.look?.theme) out.push('the palette and theme');
  if (s.look?.options)
    out.push(
      s.look.options.header.image
        ? 'the header background, with its image, motion and sections'
        : 'the header background, motion and sections',
    );
  if (s.packs?.length)
    out.push(
      `look packs: ${s.packs.map((p) => (typeof p.look.label === 'string' ? p.look.label : 'unnamed')).join(', ')}`,
    );
  return out;
}

export function BundlePage() {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [bundle, setBundle] = useState<SiteBundle | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ what: string; result: BundleResult } | null>(null);
  const [asking, setAsking] = useState(false);

  const backup = useQuery({
    queryKey: ['site-bundle-backup'],
    queryFn: ({ signal }) => call(getBundleBackup, { signal }),
  });
  const afterChange = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['site-bundle-backup'] }),
      client.invalidateQueries({ queryKey: ['site'] }),
    ]);

  const download = useMutation({
    mutationFn: async () => {
      const file = await call(exportSiteBundle, {});
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `site-bundle-${file.exported_at.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const upload = useMutation({
    mutationFn: (body: SiteBundle) => call(importSiteBundle, { body }),
    onSuccess: async (result) => {
      setDone({ what: 'The file was imported.', result });
      setBundle(null);
      await afterChange();
    },
  });
  const restore = useMutation({
    mutationFn: () => call(restoreBundleBackup, {}),
    onSuccess: async (result) => {
      setDone({ what: 'The settings from before the last import are back.', result });
      setAsking(false);
      await afterChange();
    },
  });

  async function choose(file: File | undefined) {
    setProblem(null);
    setBundle(null);
    setDone(null);
    if (!file) return;
    try {
      const parsed = SiteBundle.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) {
        setProblem(
          'That is not a site bundle, or it is from a version this site cannot read. Choose a file that was exported from a site.',
        );
        return;
      }
      setBundle(parsed.data);
    } catch {
      setProblem('That file could not be read as a site bundle.');
    }
  }

  const parts = bundle ? holds(bundle) : [];
  const last = backup.data?.backup ?? null;

  return (
    <>
      <Panel
        title="Export"
        sub="One file with the site's name, wording, pages, front page sections, social accounts and look, including the header image and any look packs."
      >
        <p>
          It holds nothing from the archive: no logbooks, questions, lists, reports, entries, people
          or files.
        </p>
        <Btn
          kind="ink"
          disabled={download.isPending}
          onClick={() => {
            download.mutate();
          }}
        >
          Download the site bundle
        </Btn>
        <ErrorNote error={download.error} />
      </Panel>

      <Panel
        title="Import"
        sub="Upload a bundle to set up or update how this site reads and looks."
      >
        <p>
          Every part the file holds replaces the same part here. A part the file does not hold is
          left as it is. Logbooks, questions, lists, reports, entries, people, roles and files are
          never touched. What is replaced is kept first, so you can put it back.
        </p>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          aria-label="Site bundle file"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
        {problem ? <Note warn>{problem}</Note> : null}
        {bundle ? (
          <Dlg
            title="Replace these settings?"
            buttons={
              <>
                <Btn
                  kind="bad"
                  disabled={upload.isPending}
                  onClick={() => {
                    upload.mutate(bundle);
                  }}
                >
                  Replace them
                </Btn>
                <Btn
                  kind="ghost"
                  onClick={() => {
                    setBundle(null);
                    if (input.current) input.current.value = '';
                  }}
                >
                  Cancel
                </Btn>
              </>
            }
          >
            <p>
              This file was exported on {bundle.exported_at.slice(0, 10)}. Importing it will
              replace, on this site, right away:
            </p>
            <ul>
              {parts.length ? (
                parts.map((p) => <li key={p}>{p}</li>)
              ) : (
                <li>nothing: the file holds no settings</li>
              )}
            </ul>
            <p>
              You will be asked for your second factor. The current settings are kept, and the
              button below puts them back.
            </p>
          </Dlg>
        ) : null}
        <ErrorNote error={upload.error} title="The file was not imported." />
        {done ? (
          <Note>
            <b>{done.what}</b>{' '}
            {done.result.written.length ? `Written: ${done.result.written.join('; ')}. ` : ''}
            {done.result.skipped.length ? `Left as it was: ${done.result.skipped.join('; ')}.` : ''}
          </Note>
        ) : null}
      </Panel>

      <Panel title="Go back" sub="Restore the settings from before the last import." kind="quiet">
        {last ? (
          <p>
            The newest kept copy was made on {new Date(last.created_at).toUTCString()} by{' '}
            {last.created_by}, just before an import. Restoring it puts back the wording, pages,
            accounts and look from then. Look packs that were installed stay installed.
          </p>
        ) : (
          <p>There is no kept copy yet. One is made each time a file is imported.</p>
        )}
        {asking ? (
          <Dlg
            title="Restore the settings from before the last import?"
            buttons={
              <>
                <Btn
                  kind="bad"
                  disabled={restore.isPending}
                  onClick={() => {
                    restore.mutate();
                  }}
                >
                  Restore them
                </Btn>
                <Btn
                  kind="ghost"
                  onClick={() => {
                    setAsking(false);
                  }}
                >
                  Cancel
                </Btn>
              </>
            }
          >
            <p>
              What the site has now (wording, pages, accounts and look) is replaced by the kept
              copy. You will be asked for your second factor.
            </p>
          </Dlg>
        ) : (
          <Btn
            kind="ghost"
            disabled={!last}
            onClick={() => {
              setAsking(true);
            }}
          >
            Restore the settings from before the last import
          </Btn>
        )}
        <ErrorNote error={restore.error} title="Nothing was restored." />
      </Panel>
    </>
  );
}
