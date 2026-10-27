/**
 * "Installed", under "Add looks from a file" on the Look screen: the built-in
 * pack, then each uploaded pack with its version, who installed it and when,
 * and Remove. Remove asks for the step-up (the API client asks, then tries
 * once more). While the site wears one of a pack's palettes or themes, or
 * another pack needs it, the row says so in words, and the server refuses
 * the removal with the same words.
 */
import { removeLookPack } from '@reportlog/contracts';
import type { InstalledLookPack } from '@reportlog/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { siteQuery } from '@/components/ui/site.tsx';
import { ApiRequestError, call } from '@/lib/api.ts';
import { lookPacksQuery } from './queries.ts';

const counts = (p: { palettes: unknown[]; themes: unknown[]; looks: unknown[] }) =>
  [
    `${String(p.palettes.length)} palette${p.palettes.length === 1 ? '' : 's'}`,
    `${String(p.themes.length)} theme${p.themes.length === 1 ? '' : 's'}`,
    `${String(p.looks.length)} look${p.looks.length === 1 ? '' : 's'}`,
  ].join(' · ');

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function InstalledLookPacks() {
  const packs = useQuery(lookPacksQuery);
  return (
    <>
      {packs.data?.packs.map((p) => (
        <PackRow key={p.id} pack={p} />
      ))}
      {packs.isError ? (
        <Note tone="serious" title="The installed packs could not be listed.">
          {packs.error instanceof ApiRequestError ? packs.error.message : null}
        </Note>
      ) : null}
    </>
  );
}

function PackRow({ pack }: { pack: InstalledLookPack }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await call(removeLookPack, { params: { id: pack.id } });
      await Promise.all([
        client.invalidateQueries({ queryKey: lookPacksQuery.queryKey }),
        client.invalidateQueries({ queryKey: siteQuery.queryKey }),
      ]);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'The pack could not be removed.');
      setBusy(false);
    }
  };
  return (
    <div className="packrow">
      <div>
        <b>{pack.label}</b> <span className="pill">{pack.version}</span>
        <p>
          {counts(pack)} · installed {day(pack.installed_at)} by{' '}
          <span className="mono">{pack.installed_by}</span>
        </p>
        {pack.in_use ? <p>{pack.in_use}</p> : null}
        {error ? (
          <Note tone="serious" title="Not removed">
            {error}
          </Note>
        ) : null}
      </div>
      <Btn
        look="ghost"
        sm
        flat

        busy={busy}
        busyLabel="Removing…"
        aria-label={`Remove ${pack.label}`}
        onClick={() => void remove()}
      >
        Remove
      </Btn>
    </div>
  );
}
