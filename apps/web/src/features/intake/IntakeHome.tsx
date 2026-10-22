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
import { Card } from '@/components/ui/card.tsx';
import { Chip } from '@/components/ui/chip.tsx';
import { Empty } from '@/components/ui/empty.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Label } from '@/components/ui/label.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { RadioGroup, RadioOption } from '@/components/ui/radio-group.tsx';
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
    <StaffPage
      title="Filing for an organization"
      lede="Type up accounts somebody gave you on paper, by phone or in person. Nothing is filed until you have checked the whole batch and said so."
      width="prose"
    >
      <Card heading="A new batch">
        {list.length > 1 ? (
          <Field>
            <Label>Which organization are these accounts for?</Label>
            <RadioGroup
              value={orgId === undefined ? '' : String(orgId)}
              onValueChange={(v) => {
                setChosen(Number(v));
              }}
            >
              {list.map((o) => (
                <RadioOption
                  key={o.organization_id}
                  value={String(o.organization_id)}
                  label={o.name}
                />
              ))}
            </RadioGroup>
          </Field>
        ) : list[0] ? (
          <p>The accounts will be filed for {list[0].name}.</p>
        ) : null}
        {start.isError ? <Alert tone="serious" title={start.error.message} /> : null}
        <div>
          <Button
            type="button"
            disabled={orgId === undefined}
            busy={start.isPending}
            busyLabel="Starting…"
            onClick={() => {
              start.mutate();
            }}
          >
            Start a new batch
          </Button>
        </div>
      </Card>

      <section aria-labelledby="your-batches" className="flex flex-col gap-3">
        <h2 id="your-batches" className="font-display text-2xl font-bold">
          Your batches
        </h2>
        {batches.isPending ? <p role="status">Loading…</p> : null}
        {batches.isError ? <Alert tone="serious" title={batches.error.message} /> : null}
        {batches.data?.batches.length === 0 ? (
          <Empty title="You have not started a batch yet">
            A batch holds the accounts you type up until you file them together.
          </Empty>
        ) : null}
        <ul className="flex flex-col gap-3">
          {batches.data?.batches.map((b) => {
            const started = new Date(b.created_at).toLocaleString();
            const filed = b.status === 'submitted';
            return (
              <li key={b.id}>
                <Card className="gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-lg font-bold">
                        <time dateTime={b.created_at}>{started}</time>
                      </span>
                      <Chip tone={filed ? 'tag' : 'open'}>{filed ? 'Filed' : 'Open'}</Chip>
                    </span>
                    <span className="text-sm text-ink-alt">{b.organization}</span>
                    <span className="font-mono text-sm">
                      {filed
                        ? `${String(b.filed)} ${b.filed === 1 ? 'account' : 'accounts'} filed`
                        : `${String(b.entries)} ${b.entries === 1 ? 'account' : 'accounts'} · ${String(b.entries - b.filed)} waiting · ${String(b.filed)} filed`}
                    </span>
                  </div>
                  <div className="shrink-0">
                    <Button asChild variant="secondary">
                      <Link
                        to="/intake/$id"
                        params={{ id: String(b.id) }}
                        aria-label={`Open the batch started ${started}`}
                      >
                        Open
                      </Link>
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>
    </StaffPage>
  );
}
