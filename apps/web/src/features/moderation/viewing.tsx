/**
 * Two moderators on one report: who else has it open, and whether it changed
 * since this page read it.
 *
 * PRESENCE IS ADVISORY. It is how two people avoid reading the same report
 * twice, not what stops one overwriting the other: the server refuses any
 * act sent with a stale `seen` (moderation/queue.ts). So a heartbeat that
 * fails is ignored, never shown as an error.
 *
 * NOTHING ON THE PAGE CHANGES UNDERNEATH THE MODERATOR. When somebody else
 * acts on the report, the page says so and offers to show it as it stands;
 * it does not reload itself while they are reading or writing.
 */
import { VIEWING_HEARTBEAT_MS, listViewing, markViewing, stopViewing } from '@reportlog/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Btn } from '../../mockup/Btn.tsx';
import { ApiRequestError, call } from '../../lib/api.ts';

/**
 * Says this report is open for as long as the component is mounted. Answers
 * with who else has it open, and whether its `seen` moved past the one the
 * page is showing.
 */
export function useViewing(threadId: string, seen: string) {
  const [others, setOthers] = useState<string[]>([]);
  // The `seen` the server last gave for the version the page is showing, or
  // null for no news since the page read it.
  const [latest, setLatest] = useState<{ shown: string; now: string } | null>(null);
  const shown = useRef(seen);
  useEffect(() => {
    shown.current = seen;
  }, [seen]);
  // Not before the page has read the report: there is nothing to compare yet.
  const ready = seen !== '';
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const beat = () => {
      const asked = shown.current;
      call(markViewing, { params: { threadId } }).then(
        (out) => {
          if (!live) return;
          setOthers(out.others.map((o) => o.email));
          setLatest({ shown: asked, now: out.seen });
        },
        () => undefined,
      );
    };
    beat();
    const timer = setInterval(beat, VIEWING_HEARTBEAT_MS);
    return () => {
      live = false;
      clearInterval(timer);
      call(stopViewing, { params: { threadId } }).catch(() => undefined);
    };
  }, [threadId, ready]);
  // An answer about a version the page has since read past (its own decision,
  // reloaded) says nothing about this one.
  const changed = latest !== null && latest.shown === seen && latest.now !== seen;
  return { others, changed };
}

/** Everybody else's open reports, for the queue's badges: thread to addresses. */
export function useOthersViewing(): ReadonlyMap<string, string[]> {
  const query = useQuery({
    queryKey: ['moderation', 'viewing'],
    queryFn: ({ signal }) => call(listViewing, { signal }),
    refetchInterval: VIEWING_HEARTBEAT_MS,
    // Advisory: a failure leaves the badges as they were, unsaid.
    retry: false,
  });
  const out = new Map<string, string[]>();
  for (const v of query.data?.viewing ?? []) {
    out.set(v.thread_id, [...(out.get(v.thread_id) ?? []), v.email]);
  }
  return out;
}

/** "maria@example.org has it open", "a@x and b@y have it open". */
export function openBy(emails: readonly string[]): string {
  const who =
    emails.length <= 1
      ? (emails[0] ?? '')
      : `${emails.slice(0, -1).join(', ')} and ${emails.at(-1) ?? ''}`;
  return `${who} ${emails.length === 1 ? 'has' : 'have'} it open`;
}

/** Puts the page's own reads of this report out of date, so they are read again. */
export function useShowAsItIs(threadId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['moderation', 'item', threadId] });
    void qc.invalidateQueries({ queryKey: ['moderation', 'note', threadId] });
    void qc.invalidateQueries({ queryKey: ['moderation', 'queue'] });
  };
}

/** The report page's notice: who else is here, and whether it moved under this page. */
export function ViewingNotice({
  threadId,
  others,
  changed,
}: {
  threadId: string;
  others: readonly string[];
  changed: boolean;
}) {
  const show = useShowAsItIs(threadId);
  if (!changed && others.length === 0) return null;
  return (
    <div className="col" role="status">
      {others.length ? (
        <div className="note">
          <span>{`${openBy(others)} too. If you are both deciding it, agree who will.`}</span>
        </div>
      ) : null}
      {changed ? (
        <div className="note warn">
          <span>
            <b>This report changed after you opened it. </b>
            Somebody acted on it. What you see here is not how it stands now.{' '}
            <Btn sm flat look="ghost" onClick={show}>
              Show it as it is now
            </Btn>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A refusal because the report moved since the page read it (409 `changed`):
 * the server's sentence says who did what, and a button reads it again.
 */
export function isChanged(error: Error | null): boolean {
  return error instanceof ApiRequestError && error.code === 'changed';
}

export function ChangedProblem({ threadId, error }: { threadId: string; error: Error }) {
  const show = useShowAsItIs(threadId);
  return (
    <div className="note warn" role="alert">
      <span>
        {error.message}{' '}
        <Btn sm flat look="ghost" onClick={show}>
          Show it as it is now
        </Btn>
      </span>
    </div>
  );
}
