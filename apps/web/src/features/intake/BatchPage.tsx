/**
 * One batch: its accounts, what each is still missing, and filing it.
 *
 * Filing is deliberately not a second "are you sure?". It says what is about
 * to happen, in numbers, and what cannot be undone, and it needs the
 * statement ticked. The server refuses without it too.
 *
 * Accounts that are not ready stay in the batch when the rest are filed.
 * Nothing is thrown away.
 */
import { addIntakeDraft, removeIntakeDraft, submitIntakeBatch } from '@reportlog/contracts';
import type { IntakeDraft } from '@reportlog/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Back } from '../../mockup/Back.tsx';
import { Btn } from '../../mockup/Btn.tsx';
import { Check } from '../../mockup/Choices.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { Modal } from '../../mockup/Modal.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Problem } from '../../mockup/Notice.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '@/lib/api.ts';
import { AccountDialog } from './AccountDialog.tsx';
import { BATCH_STATEMENT } from './parts.tsx';
import { batchQuery, openLogbooksQuery, reviewQuery, useIntakeRefresh } from './queries.ts';

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

export function BatchPage({ id }: { id: number }) {
  const batch = useQuery(batchQuery(id));
  const review = useQuery(reviewQuery(id));
  const logbooks = useQuery(openLogbooksQuery);
  const refresh = useIntakeRefresh();
  const [editing, setEditing] = useState<IntakeDraft | null>(null);
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState<{
    refs: string[];
    staged: number;
    dropped: { ref: string; names: string[] }[];
  } | null>(null);

  const add = useMutation({
    mutationFn: () => call(addIntakeDraft, { params: { id }, body: {} }),
    onSuccess: async (d) => {
      await refresh();
      setEditing(d);
    },
  });
  const remove = useMutation({
    mutationFn: (draftId: number) => call(removeIntakeDraft, { params: { id: draftId } }),
    onSuccess: refresh,
  });

  if (batch.isPending) return <p role="status">Loading…</p>;
  if (batch.isError) {
    return (
      <StaffPage area="Your organization" title="Not one of your batches">
        <p>{batch.error.message}</p>
        <Back to="/intake">All your batches</Back>
      </StaffPage>
    );
  }
  const { batch: b, drafts } = batch.data;
  const open = b.status === 'draft';
  const titleOf = (slug: string | undefined) =>
    logbooks.data?.logbooks.find((l) => l.slug === slug)?.title ?? slug;

  return (
    <StaffPage
      area="Your organization"
      title={`Batch for ${b.organization}`}
      lede={
        open
          ? 'Add each account, then check the batch and file it.'
          : 'This batch has been filed. Its accounts can be corrected, never edited.'
      }
    >
      <Back to="/intake">All your batches</Back>
      {review.data && open ? (
        <p className="m">
          {[
            plural(drafts.length, 'account', 'accounts'),
            `${String(review.data.ready)} ready`,
            review.data.blocked
              ? `${String(review.data.blocked)} ${review.data.blocked === 1 ? 'needs' : 'need'} an answer`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
      {filed ? (
        <Note>
          <b>{`Filed ${plural(filed.refs.length, 'account', 'accounts')}: ${filed.refs.join(', ')}.`}</b>{' '}
          {filed.staged
            ? `${plural(filed.staged, 'account is', 'accounts are')} still staged. Fix them and file again.`
            : null}
          {filed.dropped.map((d) => (
            <span key={d.ref} style={{ display: 'block' }}>
              {d.ref} was filed without {d.names.join(', ')}: this logbook stopped taking files
              after they were attached, so they were not kept.
            </span>
          ))}
        </Note>
      ) : null}

      {drafts.length === 0 ? (
        <Empty title="No accounts entered yet">
          Add one for each account somebody gave you. Nothing is filed until you file the batch.
        </Empty>
      ) : (
        <div className="rows tbl" role="list" aria-label="Accounts">
          <div className="row head" style={{ '--cols': '1.4fr 1fr auto' } as CSSProperties}>
            <span>Account</span>
            <span>State</span>
            <span></span>
          </div>
          {drafts.map((d) => {
            const first = Object.values(d.payload.answers ?? {}).find(
              (v) => typeof v === 'string' && v.trim(),
            );
            const n = String(d.ordinal);
            const needs = review.data?.entries.find((e) => e.id === d.id && !e.filed)?.problems;
            const filedAs = d.public_ref && d.thread_id;
            return (
              <div
                className="row"
                role="listitem"
                key={d.id}
                style={{ '--cols': '1.4fr 1fr auto' } as CSSProperties}
              >
                <span data-l="Account">
                  <b>Account {n}</b>
                  {d.payload.logbook ? (
                    <span className="m"> · {titleOf(d.payload.logbook)}</span>
                  ) : null}
                  <span style={{ display: 'block' }}>
                    {typeof first === 'string' ? first.slice(0, 160) : '(nothing entered yet)'}
                  </span>
                </span>
                <span data-l="State">
                  {filedAs ? (
                    <>
                      <span className="st ok">Filed</span>{' '}
                      <span className="mono">{d.public_ref}</span>
                    </>
                  ) : needs?.length ? (
                    <span className="st flag">Not ready: {needs.join('; ')}</span>
                  ) : (
                    <span className="st ok">Ready</span>
                  )}
                </span>
                <span data-l="">
                  {filedAs ? (
                    <Link
                      className="btn sm flat"
                      to="/intake/reports/$threadId"
                      params={{ threadId: d.thread_id ?? '' }}
                      aria-label={`Correct account ${n}`}
                    >
                      Correct it
                    </Link>
                  ) : (
                    <span className="acts">
                      <Btn
                        sm
                        flat
                        aria-label={`Change account ${n}`}
                        onClick={() => {
                          setEditing(d);
                        }}
                      >
                        Change
                      </Btn>
                      <Btn
                        sm
                        flat
                        look="ghost"
                        aria-label={`Remove account ${n}`}
                        disabled={remove.isPending}
                        onClick={() => {
                          remove.mutate(d.id);
                        }}
                      >
                        Remove
                      </Btn>
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {add.isError ? <Problem>{add.error.message}</Problem> : null}
      {remove.isError ? <Problem>{remove.error.message}</Problem> : null}
      {open ? (
        <div className="acts">
          <Btn
            sm
            flat
            disabled={add.isPending}
            onClick={() => {
              add.mutate();
            }}
          >
            Add an account
          </Btn>
        </div>
      ) : null}

      {open ? (
        <Panel title="Before filing">
          {review.data ? (
            <>
              <p>
                <b>
                  {String(review.data.ready)} ready to file
                  {review.data.blocked
                    ? `, ${String(review.data.blocked)} ${review.data.blocked === 1 ? 'still needs' : 'still need'} work`
                    : ''}
                </b>
              </p>
              {review.data.blocked ? (
                <>
                  <ul>
                    {review.data.entries
                      .filter((e) => !e.filed && e.problems.length)
                      .map((e) => (
                        <li key={e.id}>
                          Account {String(e.ordinal)}: {e.problems.join('; ')}
                        </li>
                      ))}
                  </ul>
                  <p className="muted">
                    These stay in the batch. Filing sends the ones that are ready and leaves these
                    for you to fix.
                  </p>
                </>
              ) : null}
            </>
          ) : (
            <p role="status">Checking…</p>
          )}
          <div className="acts">
            <Btn
              sm
              flat
              look="ink"
              disabled={!review.data?.ready}
              onClick={() => {
                setFiling(true);
              }}
            >
              File the ready accounts
            </Btn>
          </div>
          <p className="muted">
            Filing cannot be undone: a filed account can be corrected, which keeps both versions,
            never edited or deleted.
          </p>
        </Panel>
      ) : null}

      {editing ? (
        <AccountDialog
          key={editing.id}
          draft={editing}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={refresh}
        />
      ) : null}
      {filing && review.data ? (
        <FileDialog
          batchId={id}
          organization={b.organization}
          ready={review.data.ready}
          onClose={() => {
            setFiling(false);
          }}
          onFiled={async (refs, staged, dropped) => {
            setFiling(false);
            setFiled({ refs, staged, dropped });
            await refresh();
          }}
        />
      ) : null}
    </StaffPage>
  );
}

function FileDialog(props: {
  batchId: number;
  organization: string;
  ready: number;
  onClose: () => void;
  onFiled: (
    refs: string[],
    staged: number,
    dropped: { ref: string; names: string[] }[],
  ) => Promise<void>;
}) {
  const [attested, setAttested] = useState(false);
  const submit = useMutation({
    mutationFn: () =>
      call(submitIntakeBatch, { params: { id: props.batchId }, body: { attested: true } }),
    onSuccess: (out) =>
      props.onFiled(
        out.filed.map((f) => f.public_ref),
        out.still_staged,
        out.filed.flatMap((f) =>
          f.files_dropped ? [{ ref: f.public_ref, names: f.files_dropped }] : [],
        ),
      ),
  });
  return (
    <Modal
      title="File this batch"
      description={
        <>
          <b>{plural(props.ready, 'account is', 'accounts are')}</b> about to enter the permanent
          record, filed as <b>{props.organization}</b>.
        </>
      }
      open
      onClose={props.onClose}
      onSubmit={() => {
        if (attested && !submit.isPending) submit.mutate();
      }}
      buttons={
        <>
          <Btn sm flat look="ink" type="submit" disabled={!attested || submit.isPending}>
            File them
          </Btn>
          <Btn sm flat look="ghost" onClick={props.onClose}>
            Go back
          </Btn>
        </>
      }
    >
      <p>
        Once filed they cannot be edited or deleted, only corrected, which keeps both versions on
        the record. The organization is shown publicly; you are not. Your account is recorded as the
        person who entered them.
      </p>
      <Check
        id="attest-batch"
        checked={attested}
        onChange={(e) => {
          setAttested(e.target.checked);
        }}
      >
        {BATCH_STATEMENT}
      </Check>
      {submit.isError ? <Problem title="Nothing was filed.">{submit.error.message}</Problem> : null}
    </Modal>
  );
}
