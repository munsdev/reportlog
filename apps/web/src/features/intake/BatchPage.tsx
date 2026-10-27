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
import { Alert } from '@/components/ui/alert.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Empty } from '@/components/ui/empty.tsx';
import { CountLine } from '@/components/ui/type.tsx';
import { Button } from '@/components/ui/button.tsx';
import { CheckOption } from '@/components/ui/choice.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
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
      <StaffPage area="Your organization" title="Not one of your batches" width="prose">
        <p>{batch.error.message}</p>
        <Link to="/intake" className="underline">
          All your batches
        </Link>
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
      width="prose"
    >
      <p>
        <Link to="/intake" className="underline">
          All your batches
        </Link>
      </p>
      {review.data && open ? (
        <CountLine
          parts={[
            plural(drafts.length, 'account', 'accounts'),
            `${String(review.data.ready)} ready`,
            review.data.blocked
              ? `${String(review.data.blocked)} ${review.data.blocked === 1 ? 'needs' : 'need'} an answer`
              : null,
          ]}
        />
      ) : null}
      {filed ? (
        <Alert
          tone="done"
          title={`Filed ${plural(filed.refs.length, 'account', 'accounts')}: ${filed.refs.join(', ')}.`}
        >
          {filed.staged
            ? `${plural(filed.staged, 'account is', 'accounts are')} still staged. Fix them and file again.`
            : null}
          {filed.dropped.map((d) => (
            <p key={d.ref}>
              {d.ref} was filed without {d.names.join(', ')}: this logbook stopped taking files
              after they were attached, so they were not kept.
            </p>
          ))}
        </Alert>
      ) : null}

      <section aria-labelledby="accounts" className="flex flex-col gap-3">
        <h2 id="accounts" className="font-display text-2xl font-bold">
          Accounts
        </h2>
        {drafts.length === 0 ? (
          <Empty title="No accounts entered yet">
            Add one for each account somebody gave you. Nothing is filed until you file the batch.
          </Empty>
        ) : null}
        <ul className="flex flex-col gap-3">
          {drafts.map((d) => {
            const first = Object.values(d.payload.answers ?? {}).find(
              (v) => typeof v === 'string' && v.trim(),
            );
            const n = String(d.ordinal);
            const needs = review.data?.entries.find((e) => e.id === d.id && !e.filed)?.problems;
            return (
              <li
                key={d.id}
                className="flex flex-col gap-1 rounded-card border-(length:--rl-border-main) border-ink-alt bg-surface p-4 shadow-raised"
              >
                <p className="font-semibold">
                  Account {n}
                  {d.payload.logbook ? (
                    <span className="font-normal text-ink-alt">
                      {' '}
                      · {titleOf(d.payload.logbook)}
                    </span>
                  ) : null}
                </p>
                <p className="text-sm">
                  {typeof first === 'string' ? first.slice(0, 160) : '(nothing entered yet)'}
                </p>
                {needs?.length ? (
                  <p className="text-sm text-ink-alt">Not ready: {needs.join('; ')}</p>
                ) : null}
                {d.public_ref && d.thread_id ? (
                  <p className="text-sm">
                    Filed as <span className="font-mono">{d.public_ref}</span> ·{' '}
                    <Link
                      to="/intake/reports/$threadId"
                      params={{ threadId: d.thread_id }}
                      className="underline"
                      aria-label={`Correct account ${n}`}
                    >
                      Correct it
                    </Link>
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      type="button"

                      variant="secondary"
                      aria-label={`Change account ${n}`}
                      onClick={() => {
                        setEditing(d);
                      }}
                    >
                      Change
                    </Button>
                    <Button
                      type="button"

                      variant="quiet"
                      aria-label={`Remove account ${n}`}
                      disabled={remove.isPending}
                      onClick={() => {
                        remove.mutate(d.id);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {add.isError ? <Alert tone="serious" title={add.error.message} /> : null}
        {remove.isError ? <Alert tone="serious" title={remove.error.message} /> : null}
        {open ? (
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={add.isPending}
              onClick={() => {
                add.mutate();
              }}
            >
              Add an account
            </Button>
          </div>
        ) : null}
      </section>

      {open ? (
        <Card heading="Before filing">
          {review.data ? (
            <>
              <p className="font-semibold">
                {String(review.data.ready)} ready to file
                {review.data.blocked
                  ? `, ${String(review.data.blocked)} ${review.data.blocked === 1 ? 'still needs' : 'still need'} work`
                  : ''}
              </p>
              {review.data.blocked ? (
                <>
                  <ul className="list-disc pl-5">
                    {review.data.entries
                      .filter((e) => !e.filed && e.problems.length)
                      .map((e) => (
                        <li key={e.id}>
                          Account {String(e.ordinal)}: {e.problems.join('; ')}
                        </li>
                      ))}
                  </ul>
                  <p className="text-sm text-ink-alt">
                    These stay in the batch. Filing sends the ones that are ready and leaves these
                    for you to fix.
                  </p>
                </>
              ) : null}
            </>
          ) : (
            <p role="status">Checking…</p>
          )}
          <div>
            <Button
              type="button"
              disabled={!review.data?.ready}
              onClick={() => {
                setFiling(true);
              }}
            >
              File the ready accounts
            </Button>
          </div>
          <p className="text-sm text-ink-alt">
            Filing cannot be undone: a filed account can be corrected, which keeps both versions,
            never edited or deleted.
          </p>
        </Card>
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
    <Dialog
      open
      onOpenChange={(on) => {
        if (!on) props.onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>File this batch</DialogTitle>
        <DialogDescription>
          <b>{plural(props.ready, 'account is', 'accounts are')}</b> about to enter the permanent
          record, filed as <b>{props.organization}</b>.
        </DialogDescription>
        <p>
          Once filed they cannot be edited or deleted, only corrected, which keeps both versions on
          the record. The organization is shown publicly; you are not. Your account is recorded as
          the person who entered them.
        </p>
        <CheckOption
          id="attest-batch"
          checked={attested}
          onCheckedChange={(on) => {
            setAttested(on === true);
          }}
          label={BATCH_STATEMENT}
        />
        {submit.isError ? (
          <Alert tone="serious" title="Nothing was filed">
            {submit.error.message}
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={props.onClose}>
            Go back
          </Button>
          <Button
            type="button"
            disabled={!attested || submit.isPending}
            onClick={() => {
              submit.mutate();
            }}
          >
            File them
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
