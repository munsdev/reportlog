/**
 * "Publish as counts only", per logbook (Plan E, PE3). An administrator's
 * setting: its accepted reports are counted on every count, map and figure,
 * and shown as an entry nowhere. Each change is a public switch use.
 */
import { listCountsOnly, setCountsOnly } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from '../../components/ui/alert.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Label } from '../../components/ui/label.tsx';
import { call } from '../../lib/api.ts';

const countsOnlyQuery = queryOptions({
  queryKey: ['moderation', 'counts-only'],
  queryFn: ({ signal }) => call(listCountsOnly, { signal }),
});

export function CountsOnlySettings() {
  const qc = useQueryClient();
  const query = useQuery(countsOnlyQuery);
  const set = useMutation({
    mutationFn: (v: { slug: string; counts_only: boolean }) =>
      call(setCountsOnly, { params: { slug: v.slug }, body: { counts_only: v.counts_only } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['moderation'] });
      await qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
  if (!query.data) return null;
  return (
    <section
      aria-labelledby="counts-only"
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
    >
      <h2 id="counts-only" className="font-display text-xl font-bold">
        Publish as counts only
      </h2>
      <p className="text-sm text-ink-alt">
        A logbook published as counts only shows its accepted reports as counts by place and time,
        and never one by one: not on the board, a report’s page, the spreadsheet, the chain file,
        the daily snapshot or a digest. Every change is shown publicly with its time.
      </p>
      {query.data.logbooks.length === 0 ? <p>No logbook has launched yet.</p> : null}
      <ul className="flex flex-col gap-2">
        {query.data.logbooks.map((l) => (
          <li key={l.slug} className="flex items-center gap-2">
            <Checkbox
              id={`counts-${l.slug}`}
              checked={l.counts_only}
              disabled={set.isPending}
              onCheckedChange={(v) => {
                set.mutate({ slug: l.slug, counts_only: v === true });
              }}
            />
            <Label htmlFor={`counts-${l.slug}`}>{l.title} is published as counts only</Label>
          </li>
        ))}
      </ul>
      {set.error ? <Alert tone="serious">{set.error.message}</Alert> : null}
    </section>
  );
}
