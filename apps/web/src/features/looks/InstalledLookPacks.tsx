/**
 * "Installed", under "Add looks from a file" on the Look screen: the built-in
 * pack, then each uploaded pack with its version, who installed it and when,
 * and Remove. Remove asks for the step-up (the API client asks, then tries
 * once more). While the site wears one of a pack's palettes or themes, or
 * another pack needs it, the row says so in words, and the server refuses
 * the removal with the same words.
 */
import { CORE_PACK, removeLookPack } from '@reportlog/contracts';
import type { InstalledLookPack } from '@reportlog/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
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
  const headingId = useId();
  const packs = useQuery(lookPacksQuery);
  const builtIn = {
    palettes: CORE_PACK.palettes ?? [],
    themes: CORE_PACK.themes ?? [],
    looks: CORE_PACK.looks ?? [],
  };
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="font-display text-lg font-bold">
        Installed
      </h3>
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        <li className="flex flex-col gap-1 py-3">
          <span className="font-semibold">ReportLog, built in</span>
          <span className="text-sm text-ink-alt">{counts(builtIn)}</span>
        </li>
        {packs.data?.packs.map((p) => (
          <PackRow key={p.id} pack={p} />
        ))}
      </ul>
      {packs.isError ? (
        <Alert tone="serious" title="The installed packs could not be listed.">
          {packs.error instanceof ApiRequestError ? packs.error.message : null}
        </Alert>
      ) : null}
    </section>
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
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <span className="font-semibold">
          {pack.label} <span className="font-mono text-sm">{pack.version}</span>
        </span>
        <span className="text-sm text-ink-alt">
          {counts(pack)} · installed {day(pack.installed_at)} by{' '}
          <span className="font-mono">{pack.installed_by}</span>
        </span>
        {pack.in_use ? <span className="text-sm">{pack.in_use}</span> : null}
        {error ? (
          <Alert tone="serious" title="Not removed">
            {error}
          </Alert>
        ) : null}
      </div>
      <Button
        variant="quiet"
        busy={busy}
        busyLabel="Removing…"
        aria-label={`Remove ${pack.label}`}
        onClick={() => void remove()}
      >
        Remove
      </Button>
    </li>
  );
}
