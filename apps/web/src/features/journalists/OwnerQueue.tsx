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
import type { ReactNode } from 'react';
import { PTabs } from '@/mockup/PTabs.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { Btn } from '@/mockup/Btn.tsx';
import { Chip } from '../../mockup/Chip.tsx';
import { Dl } from '../../mockup/Dl.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Modal } from '../../mockup/Modal.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';

const KEY = ['owner', 'journalists'] as const;

/** The page's own two tabs: the requests and the agreement they accept. */
export function JournalistTabs() {
  const { pathname } = useLocation();
  const agreement = pathname.replace(/\/+$/, '').endsWith('/agreement');
  return (
    <PTabs
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
      title="Journalist requests"
      lede="Journalists who asked for the desk. Approving lets them see checked links and sources. Only you decide, one at a time."
    >
      <JournalistTabs />
      {requests.isPending ? <p role="status">Loading…</p> : null}
      <ErrorLine error={requests.error} />
      {requests.data ? (
        <>
          <h2 className="h-sec">Waiting ({waiting.length})</h2>
          {waiting.length ? (
            waiting.map((r) => <RequestCard key={r.id} r={r} />)
          ) : (
            <Empty title="No requests are waiting">
              A journalist on the alert list asks from the link they are emailed; their request
              appears here.
            </Empty>
          )}
          <h2 className="h-sec">Approved and revoked</h2>
          {decided.length ? (
            <Tbl
              cols={['Who', 'Since', '']}
              widths="1fr 1fr auto"
              rows={decided.map((r) => ({
                key: r.id,
                cells: [
                  <>
                    {r.name} <span className="mono">{r.address}</span>
                  </>,
                  r.status === 'revoked' && r.revoked_at
                    ? `Revoked ${when(r.revoked_at)}`
                    : r.decided_at
                      ? when(r.decided_at)
                      : '',
                  r.status === 'approved' ? (
                    <RevokeButton r={r} />
                  ) : (
                    <Chip kind="off">Access revoked</Chip>
                  ),
                ],
              }))}
            />
          ) : (
            <Empty title="Nobody approved yet">
              Approved journalists are listed here, with a way to take their access back.
            </Empty>
          )}
        </>
      ) : null}
    </StaffPage>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString();

const STATUS: Record<AccessRequestView['status'], { kind: 'wait' | 'ok' | 'off'; words: string }> =
  {
    pending: { kind: 'wait', words: 'Waiting' },
    approved: { kind: 'ok', words: 'Approved' },
    revoked: { kind: 'off', words: 'Access revoked' },
  };

function RevokeButton({ r }: { r: AccessRequestView }) {
  const client = useQueryClient();
  const act = useMutation({
    mutationFn: () => call(revokeJournalist, { params: { id: r.id } }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <>
      <Btn
        sm
        flat
        look="ghost"
        disabled={act.isPending}
        title="Takes effect on their next request to the desk. They stay on the alert list."
        onClick={() => {
          act.mutate();
        }}
      >
        Revoke access
      </Btn>
      <ErrorLine error={act.error} />
    </>
  );
}

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
  const facts: [ReactNode, ReactNode][] = [
    ['Address', r.address],
    ['Covers', r.states.join(', ')],
    ['Who they are', `${r.role}, ${r.outlet}`],
    ...(r.about ? [['In their words', r.about] as [ReactNode, ReactNode]] : []),
  ];
  // Text, never a link: any address in it is copied on purpose.
  if (r.links.length) {
    facts.push([
      'Published work',
      <ul key="links">
        {r.links.map((l) => (
          <li key={l} className="mono">
            {l}
          </li>
        ))}
      </ul>,
    ]);
  }
  facts.push([
    'Press card',
    r.press_card_number || r.press_card_issuer
      ? [r.press_card_number, r.press_card_issuer].filter(Boolean).join(', issued by ')
      : 'None given',
  ]);
  facts.push(['Asked', when(r.requested_at)]);
  if (r.decided_at) facts.push(['Approved', `${when(r.decided_at)} by ${r.decided_by ?? ''}`]);
  if (r.revoked_at) facts.push(['Revoked', when(r.revoked_at)]);
  const status = STATUS[r.status];
  return (
    <>
      <Panel as="article" title={r.name} head={<Chip kind={status.kind}>{status.words}</Chip>}>
        <Dl items={facts} />
        <ErrorLine error={act.error} />
        {r.status === 'pending' ? (
          <div className="acts">
            <Btn
              sm
              flat
              look="ink"
              disabled={act.isPending}
              onClick={() => {
                act.mutate('approve');
              }}
            >
              Approve
            </Btn>
            <Btn
              sm
              flat
              look="ghost"
              disabled={act.isPending}
              onClick={() => {
                setAsking(true);
              }}
            >
              Reject and delete
            </Btn>
          </div>
        ) : null}
      </Panel>
      <Modal
        open={asking}
        onClose={() => {
          setAsking(false);
        }}
        title={`Reject the request from ${r.name}?`}
        text="This deletes what they sent: their outlet, role, what they said about themselves and press card. It cannot be undone. They stay on the alert list and can ask again."
        buttons={
          <>
            <Btn
              sm
              flat
              look="ghost"
              onClick={() => {
                setAsking(false);
              }}
            >
              Keep the request
            </Btn>
            <Btn
              sm
              flat
              look="ink"
              disabled={act.isPending}
              onClick={() => {
                setAsking(false);
                act.mutate('reject');
              }}
            >
              Reject and delete
            </Btn>
          </>
        }
      />
    </>
  );
}
