/**
 * Filing for an organization: the coordinator's batches, and starting one.
 *
 * With one organization the choice is made for them and not shown. With two
 * or more it is a real choice, made once per batch and never per account,
 * which is where mistakes would come from.
 */
import { createIntakeBatch } from '@reportlog/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
import { Select } from '@/components/ui/select.tsx';
import { call } from '@/lib/api.ts';
import { batchesQuery, organizationsQuery, useIntakeRefresh } from './queries.ts';

export function IntakeHome() {
  const orgs = useQuery(organizationsQuery);
  const batches = useQuery(batchesQuery);
  const refresh = useIntakeRefresh();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<number | null>(null);
  const list = orgs.data?.organizations ?? [];
  const orgId = chosen ?? list[0]?.organization_id;
  const start = useMutation({
    mutationFn: () => call(createIntakeBatch, { body: { organization_id: orgId } }),
    onSuccess: async (b) => {
      await refresh();
      await navigate({ to: '/intake/$id', params: { id: String(b.id) } });
    },
  });

  return (
    <Page
      title="Filing for an organization"
      lede="Type up accounts somebody gave you on paper, by phone or in person. Nothing is filed until you have checked the whole batch and said so."
      width="prose"
    >
      <section aria-labelledby="new-batch" className="flex flex-col gap-3">
        <h2 id="new-batch" className="font-display text-xl font-bold">
          A new batch
        </h2>
        {list.length > 1 ? (
          <Field>
            <Label>Which organization are these accounts for?</Label>
            <Select
              value={orgId === undefined ? '' : String(orgId)}
              onChange={(e) => {
                setChosen(Number(e.target.value));
              }}
            >
              {list.map((o) => (
                <option key={o.organization_id} value={o.organization_id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : list[0] ? (
          <p>The accounts will be filed for {list[0].name}.</p>
        ) : null}
        {start.isError ? <Alert tone="serious" title={start.error.message} /> : null}
        <div>
          <Button
            type="button"
            disabled={orgId === undefined || start.isPending}
            onClick={() => {
              start.mutate();
            }}
          >
            Start a new batch
          </Button>
        </div>
      </section>

      <section aria-labelledby="your-batches" className="flex flex-col gap-3">
        <h2 id="your-batches" className="font-display text-xl font-bold">
          Your batches
        </h2>
        {batches.isPending ? <p role="status">Loading…</p> : null}
        {batches.isError ? <Alert tone="serious" title={batches.error.message} /> : null}
        {batches.data?.batches.length === 0 ? <p>You have not started a batch yet.</p> : null}
        <ul className="flex flex-col gap-3">
          {batches.data?.batches.map((b) => (
            <li key={b.id} className="rounded-card border border-line bg-surface p-4">
              <p className="font-semibold">{b.organization}</p>
              <p className="text-sm text-ink-alt">
                Started{' '}
                <time dateTime={b.created_at}>{new Date(b.created_at).toLocaleString()}</time> ·{' '}
                {b.status === 'submitted'
                  ? `Filed (${String(b.filed)} ${b.filed === 1 ? 'account' : 'accounts'})`
                  : `${String(b.entries - b.filed)} waiting, ${String(b.filed)} filed`}
              </p>
              <Link
                to="/intake/$id"
                params={{ id: String(b.id) }}
                className="underline"
                aria-label={`Open the batch started ${new Date(b.created_at).toLocaleString()}`}
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}
