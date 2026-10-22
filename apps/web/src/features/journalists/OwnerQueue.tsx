/**
 * The owner's journalist queue (J7b, J7, J13): /access/journalists.
 *
 * The owner alone sees requests and decides each one; nothing is approved
 * automatically. Rejecting deletes what the person sent and leaves them on
 * the alert list, and asks first, because it cannot be undone. Revoking
 * takes effect on the journalist's next request.
 * The journalist agreement (J8) is published on /access/journalists/agreement,
 * the second of the page's own tabs (settings-and-admin.md §12).
 *
 * Links in a request are shown as text, never as anchors: the owner copies
 * one into a browser on purpose, and this site never fetches it.
 */
import {
  approveAccessRequest,
  listAccessRequests,
  rejectAccessRequest,
  revokeJournalist,
} from '@reportlog/contracts';
import type { AccessRequestView } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Chip } from '@/components/ui/chip.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Empty } from '@/components/ui/empty.tsx';
import { KeyValueList } from '@/components/ui/key-value-list.tsx';
import type { KeyValue } from '@/components/ui/key-value-list.tsx';
import { CountLine } from '@/components/ui/type.tsx';
import { TabRow } from '@/features/nav/AreaTabs.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';

const KEY = ['owner', 'journalists'] as const;

/** The page's own two tabs: the requests and the agreement they accept. */
export function JournalistTabs() {
  const { pathname } = useLocation();
  const agreement = pathname.replace(/\/+$/, '').endsWith('/agreement');
  return (
    <TabRow
      label="Journalists"
      tabs={[
        { to: '/access/journalists', label: 'Requests', current: !agreement },
        { to: '/access/journalists/agreement', label: 'The agreement', current: agreement },
      ]}
    />
  );
}

export function OwnerQueuePage() {
  const requests = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => call(listAccessRequests, { signal }),
  });
  const all = requests.data?.requests ?? [];
  const waiting = all.filter((r) => r.status === 'pending');
  const decided = all.filter((r) => r.status !== 'pending');
  return (
    <StaffPage
      title="Journalists"
      lede="Requests for access to the journalist desk. Only you decide them, one at a time; nothing is approved by itself."
    >
      <JournalistTabs />
      {requests.isPending ? <p role="status">Loading…</p> : null}
      {requests.isError ? <Alert tone="serious">{requests.error.message}</Alert> : null}
      {requests.data ? (
        <>
          <CountLine
            parts={[
              `${String(waiting.length)} waiting`,
              `${String(decided.filter((r) => r.status === 'approved').length)} approved`,
              `${String(decided.filter((r) => r.status === 'revoked').length)} revoked`,
            ]}
          />
          <section aria-labelledby="waiting" className="flex flex-col gap-4">
            <h2 id="waiting" className="font-display text-2xl font-bold">
              Waiting ({waiting.length})
            </h2>
            {waiting.length ? (
              waiting.map((r) => <RequestCard key={r.id} r={r} />)
            ) : (
              <Empty title="No requests are waiting">
                A journalist on the alert list asks from the link they are emailed; their request
                appears here.
              </Empty>
            )}
          </section>
          <section aria-labelledby="decided" className="flex flex-col gap-4">
            <h2 id="decided" className="font-display text-2xl font-bold">
              Approved and revoked
            </h2>
            {decided.length ? (
              decided.map((r) => <RequestCard key={r.id} r={r} />)
            ) : (
              <Empty title="Nobody approved yet">
                Approved journalists are listed here, with a way to take their access back.
              </Empty>
            )}
          </section>
        </>
      ) : null}
    </StaffPage>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString();

const STATUS: Record<AccessRequestView['status'], { tone: 'open' | 'tag'; words: string }> = {
  pending: { tone: 'open', words: 'Waiting' },
  approved: { tone: 'tag', words: 'Approved' },
  revoked: { tone: 'tag', words: 'Access revoked' },
};

function RequestCard({ r }: { r: AccessRequestView }) {
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const act = useMutation({
    mutationFn: (what: 'approve' | 'reject' | 'revoke') =>
      call(
        what === 'approve'
          ? approveAccessRequest
          : what === 'reject'
            ? rejectAccessRequest
            : revokeJournalist,
        { params: { id: r.id } },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });
  const facts: KeyValue[] = [
    { key: 'Address', value: r.address, mono: true },
    { key: 'Covers', value: r.states.join(', ') },
    {
      key: 'Published work',
      value: (
        // Text, never a link: the owner copies one on purpose.
        <ul>
          {r.links.map((l) => (
            <li key={l} className="font-mono text-sm break-all select-all">
              {l}
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: 'Press card',
      value:
        r.press_card_number || r.press_card_issuer
          ? [r.press_card_number, r.press_card_issuer].filter(Boolean).join(', issued by ')
          : 'None given',
    },
    { key: 'Asked', value: when(r.requested_at) },
  ];
  if (r.decided_at) {
    facts.push({ key: 'Approved', value: `${when(r.decided_at)} by ${r.decided_by ?? ''}` });
  }
  if (r.revoked_at) facts.push({ key: 'Revoked', value: when(r.revoked_at) });
  const status = STATUS[r.status];
  return (
    <article aria-label={`Request from ${r.name}`}>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="font-display text-xl font-bold">
            {r.name}, {r.role} at {r.outlet}
          </h3>
          <Chip tone={status.tone}>{status.words}</Chip>
        </div>
        <KeyValueList items={facts} className="text-sm" />
        {act.isError ? <Alert tone="serious">{act.error.message}</Alert> : null}
        {r.status === 'pending' ? (
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={act.isPending}
              onClick={() => {
                act.mutate('approve');
              }}
            >
              Approve
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={act.isPending}
              onClick={() => {
                setAsking(true);
              }}
            >
              Reject and delete
            </Button>
          </div>
        ) : null}
        {r.status === 'approved' ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-alt">
              Revoking takes effect on their next request to the desk. They stay on the alert list.
            </p>
            <div>
              <Button
                type="button"
                variant="secondary"
                disabled={act.isPending}
                onClick={() => {
                  act.mutate('revoke');
                }}
              >
                Revoke access
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject the request from {r.name}?</DialogTitle>
            <DialogDescription>
              This deletes what they sent: their outlet, role, links and press card. It cannot be
              undone. They stay on the alert list and can ask again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setAsking(false);
              }}
            >
              Keep the request
            </Button>
            <Button
              variant="secondary"
              disabled={act.isPending}
              onClick={() => {
                setAsking(false);
                act.mutate('reject');
              }}
            >
              Reject and delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
