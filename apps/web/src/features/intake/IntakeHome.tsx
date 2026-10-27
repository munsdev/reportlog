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
import type { CSSProperties } from 'react';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '@/lib/api.ts';
import { Chip } from '../../mockup/Chip.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { SelectField } from '@/mockup/Field.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { batchesQuery, organizationsQuery, useIntakeRefresh } from './queries.ts';

const ROW_COLS = { '--cols': '1fr auto' } as CSSProperties;

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
      area="Your organization"
      title="Filing for an organization"
      lede="Type up accounts your observers collected, then file them together. Nothing is filed until you have checked the whole batch and said so."
    >
      <Panel title="A new batch">
        {list.length > 1 ? (
          <SelectField
            label="Which organization are these accounts for?"
            value={orgId === undefined ? '' : String(orgId)}
            onChange={(e) => {
              setChosen(Number(e.target.value));
            }}
          >
            {list.map((o) => (
              <option key={o.organization_id} value={String(o.organization_id)}>
                {o.name}
              </option>
            ))}
          </SelectField>
        ) : list[0] ? (
          <p>The accounts will be filed for {list[0].name}.</p>
        ) : null}
        <ErrorLine error={start.error} />
        <Btn sm flat
          look="ink"
          disabled={orgId === undefined || start.isPending}
          onClick={() => {
            start.mutate();
          }}
        >
          {start.isPending ? 'Starting…' : 'Start a new batch'}
        </Btn>
      </Panel>

      <h2 className="h-sec">Your batches</h2>
      {batches.isPending ? <p role="status">Loading…</p> : null}
      <ErrorLine error={batches.error} />
      {batches.data?.batches.length === 0 ? (
        <Empty title="You have not started a batch yet">
          A batch holds the accounts you type up until you file them together.
        </Empty>
      ) : null}
      {batches.data?.batches.length ? (
        <div className="rows">
          {batches.data.batches.map((b) => {
            const started = new Date(b.created_at).toLocaleString();
            const filed = b.status === 'submitted';
            return (
              <Link
                key={b.id}
                className="row"
                to="/intake/$id"
                params={{ id: String(b.id) }}
                aria-label={`Open the batch started ${started}`}
                style={ROW_COLS}
              >
                <span className="t">
                  Batch of <time dateTime={b.created_at}>{started}</time> · {b.organization} ·{' '}
                  {filed
                    ? `${String(b.filed)} ${b.filed === 1 ? 'account' : 'accounts'} filed`
                    : `${String(b.entries)} ${b.entries === 1 ? 'account' : 'accounts'} · ${String(b.entries - b.filed)} waiting · ${String(b.filed)} filed`}
                </span>
                <span>
                  <Chip kind={filed ? 'ok' : ''}>{filed ? 'Filed' : 'Open'}</Chip>
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </StaffPage>
  );
}
