/**
 * The owner's journalist queue (J7b, J7, J13): /access/journalists.
 *
 * The owner alone sees requests and decides each one; nothing is approved
 * automatically. Rejecting deletes what the person sent and leaves them on
 * the alert list. Revoking takes effect on the journalist's next request.
 * The journalist agreement (J8) is published on /access/journalists/agreement.
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
import { Link } from '@tanstack/react-router';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Page } from '@/components/ui/page.tsx';
import { call } from '../../lib/api.ts';

const KEY = ['owner', 'journalists'] as const;

export function OwnerQueuePage() {
  const requests = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => call(listAccessRequests, { signal }),
  });
  if (requests.isPending) return <p role="status">Loading…</p>;
  if (requests.isError) return <Alert tone="serious">{requests.error.message}</Alert>;
  const all = requests.data.requests;
  const waiting = all.filter((r) => r.status === 'pending');
  const decided = all.filter((r) => r.status !== 'pending');
  return (
    <Page
      title="Journalists"
      lede="Requests for access to the journalist desk. Only you decide them, one at a time."
    >
      <section aria-labelledby="waiting" className="flex flex-col gap-4">
        <h2 id="waiting" className="font-display text-xl font-bold">
          Waiting ({waiting.length})
        </h2>
        {waiting.length ? (
          waiting.map((r) => <RequestCard key={r.id} r={r} />)
        ) : (
          <p>No requests are waiting.</p>
        )}
      </section>
      <section aria-labelledby="decided" className="flex flex-col gap-4">
        <h2 id="decided" className="font-display text-xl font-bold">
          Approved and revoked
        </h2>
        {decided.length ? (
          decided.map((r) => <RequestCard key={r.id} r={r} />)
        ) : (
          <p>Nobody has been approved yet.</p>
        )}
      </section>
      <p>
        The journalist agreement is on{' '}
        <Link to="/access/journalists/agreement" className="underline">
          its own page
        </Link>
        . The desk stays closed until one is published.
      </p>
    </Page>
  );
}

function RequestCard({ r }: { r: AccessRequestView }) {
  const client = useQueryClient();
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
  return (
    <article
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
      aria-label={`Request from ${r.name}`}
    >
      <h3 className="font-semibold">
        {r.name}, {r.role} at {r.outlet}
      </h3>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Address</dt>
        <dd>{r.address}</dd>
        <dt className="text-muted">Covers</dt>
        <dd>{r.states.join(', ')}</dd>
        <dt className="text-muted">Published work</dt>
        <dd>
          <ul>
            {r.links.map((l) => (
              <li key={l} className="break-all font-mono">
                {l}
              </li>
            ))}
          </ul>
        </dd>
        <dt className="text-muted">Press card</dt>
        <dd>
          {r.press_card_number || r.press_card_issuer
            ? [r.press_card_number, r.press_card_issuer].filter(Boolean).join(', issued by ')
            : 'None given'}
        </dd>
        <dt className="text-muted">Asked</dt>
        <dd>{new Date(r.requested_at).toLocaleString()}</dd>
        {r.decided_at ? (
          <>
            <dt className="text-muted">Approved</dt>
            <dd>
              {new Date(r.decided_at).toLocaleString()} by {r.decided_by}
            </dd>
          </>
        ) : null}
        {r.revoked_at ? (
          <>
            <dt className="text-muted">Revoked</dt>
            <dd>{new Date(r.revoked_at).toLocaleString()}</dd>
          </>
        ) : null}
      </dl>
      {act.isError ? <Alert tone="serious">{act.error.message}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        {r.status === 'pending' ? (
          <>
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
                act.mutate('reject');
              }}
            >
              Reject and delete
            </Button>
          </>
        ) : null}
        {r.status === 'approved' ? (
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
        ) : null}
      </div>
    </article>
  );
}
