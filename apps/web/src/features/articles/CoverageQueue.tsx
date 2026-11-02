/**
 * The moderators' coverage queue (decision 84): articles journalists linked,
 * oldest first, each with its card and two buttons. Approving shows it
 * wherever its author chose (the public list and maps, or their profile
 * only); nothing goes public without it. The note is optional and goes to
 * the author.
 *
 * What a moderator judges is narrow: is this an article, and is it about an
 * event of the kind the site records, in the places named? Not whether it is
 * right. The journalist was vetted when they were given access.
 */
import { decideArticle } from '@reportlog/contracts';
import type { QueuedArticle } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Btn } from '@/mockup/Btn.tsx';
import { Textarea } from '@/mockup/Field.tsx';
import { ErrorNote, Waiting } from '@/mockup/Note.tsx';
import { call } from '../../lib/api.ts';
import { StaffPage } from '../nav/StaffPage.tsx';
import { LinkCard } from './LinkCard.tsx';
import { coverageQueueQuery } from './queries.ts';

type Show = 'waiting' | 'approved' | 'declined';
const SHOWS: [Show, string][] = [
  ['waiting', 'Waiting'],
  ['approved', 'Approved'],
  ['declined', 'Not approved'],
];

export function CoverageQueue() {
  const [show, setShow] = useState<Show>('waiting');
  const q = useQuery(coverageQueueQuery(show));
  return (
    <StaffPage
      title="Coverage"
      area="Moderation"
      lede="Articles journalists linked to events. Check that each is an article about the kind of thing this site records, in the places it names. Approving shows it where its author chose; nothing is public before that."
    >
      <div className="grid gap-4">
        <div role="group" aria-label="Show" className="seg">
          {SHOWS.map(([v, name]) => (
            <button
              key={v}
              type="button"
              aria-pressed={v === show}
              onClick={() => {
                setShow(v);
              }}
            >
              {name}
              {v === 'waiting' && q.data ? ` (${String(q.data.waiting)})` : ''}
            </button>
          ))}
        </div>
        {q.isPending ? (
          <Waiting>Loading…</Waiting>
        ) : q.isError ? (
          <ErrorNote error={q.error} />
        ) : q.data.articles.length === 0 ? (
          <p className="muted">{show === 'waiting' ? 'Nothing is waiting.' : 'None yet.'}</p>
        ) : (
          q.data.articles.map((a) => <Queued key={a.id} article={a} />)
        )}
      </div>
    </StaffPage>
  );
}

function Queued({ article }: { article: QueuedArticle }) {
  const client = useQueryClient();
  const id = useId();
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'declined') =>
      call(decideArticle, {
        params: { id: article.id },
        body: { decision, ...(note.trim() ? { note } : {}) },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['coverage'] });
    },
  });
  return (
    <LinkCard article={article}>
      <p className="m">
        {article.listed
          ? 'Its author wants it on the public list and the maps.'
          : 'Its author keeps it to their profile.'}{' '}
        {article.review !== 'waiting' && article.reviewed_by
          ? `Decided by ${article.reviewed_by}.`
          : null}
      </p>
      {article.review_note ? <p className="m">Note: {article.review_note}</p> : null}
      <label className="grid gap-1" htmlFor={`${id}-note`}>
        <span className="m">Note to the journalist (optional)</span>
        <Textarea
          id={`${id}-note`}
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </label>
      <ErrorNote error={decide.error} />
      <div className="btn-row">
        {article.review !== 'approved' ? (
          <Btn
            sm
            look="go"
            busy={decide.isPending}
            onClick={() => {
              decide.mutate('approved');
            }}
          >
            Approve
          </Btn>
        ) : null}
        {article.review !== 'declined' ? (
          <Btn
            sm
            look="bad"
            busy={decide.isPending}
            onClick={() => {
              decide.mutate('declined');
            }}
          >
            {article.review === 'approved' ? 'Take it down' : 'Do not approve'}
          </Btn>
        ) : null}
      </div>
    </LinkCard>
  );
}
