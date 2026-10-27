/**
 * Finding somebody's entries, for a subject access request: "what do you hold
 * about me". Administrators only, across every list.
 *
 * It searches the personal half (what was written, and the address), because
 * that is where a person is. WHAT HAS BEEN ERASED IS NOT FOUND: the page says
 * so, so that an empty answer is read as "nothing held", which it is.
 *
 * The words go in the body of a POST, never the address, so a name or an
 * email address typed here is in no browser history.
 */
import { searchListEntries } from '@reportlog/contracts';
import type { FoundListEntry, ListSearchResult } from '@reportlog/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Note } from '@/mockup/NoteBox.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { Panel } from '@/mockup/PanelBox.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { REVIEW, TRIAGE, said } from './words.ts';

export function ListSearch() {
  const [q, setQ] = useState('');
  const search = useMutation({
    mutationFn: (words: string) => call(searchListEntries, { body: { q: words } }),
  });
  return (
    <StaffPage
      title="Find somebody's entries"
      lede="For answering a request to see or delete what somebody sent. It looks through what people wrote on every list and the email addresses they gave. Anything already deleted is not found, because it is not kept."
    >
      <Panel heading="Look for">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            search.mutate(q);
          }}
        >
          <div className="search">
            <label className="vh" htmlFor="find-entries">
              Look for
            </label>
            <input
              id="find-entries"
              type="search"
              placeholder="A name, an email address, or words they wrote"
              value={q}
              maxLength={200}
              aria-describedby="find-entries-help"
              onChange={(e) => {
                setQ(e.target.value);
              }}
            />
            <Btn sm flat type="submit"  disabled={search.isPending}>
              Find
            </Btn>
          </div>
          <p id="find-entries-help" className="muted">
            A name, an email address, or words they used. Put a phrase in quotes, use “or” for
            either of two, and a minus sign to leave a word out.
          </p>
        </form>
      </Panel>
      {search.isPending ? <p role="status">Looking…</p> : null}
      {search.isError ? <Note tone="serious">{search.error.message}</Note> : null}
      {search.data ? <Results result={search.data} /> : null}
    </StaffPage>
  );
}

function Results({ result }: { result: ListSearchResult }) {
  const lists = new Map(result.lists.map((l) => [l.id, l]));
  if (!result.entries.length) {
    return (
      <p role="status">
        Nothing on any list has “{result.query}” in it. Nothing deleted is kept, so nothing deleted
        is found.
      </p>
    );
  }
  return (
    <section aria-label="Entries found" className="form-stack" style={{ maxWidth: 'none' }}>
      <p role="status">
        {result.more
          ? `More than ${String(result.entries.length)} entries have “${result.query}” in them. The newest ${String(result.entries.length)} are shown; add words to narrow it.`
          : `${String(result.entries.length)} ${result.entries.length === 1 ? 'entry has' : 'entries have'} “${result.query}” in ${result.entries.length === 1 ? 'it' : 'them'}.`}
      </p>
      {result.entries.map((e) => (
        <Found key={e.id} entry={e} list={lists.get(e.list_id)} />
      ))}
    </section>
  );
}

function Found({
  entry: e,
  list,
}: {
  entry: FoundListEntry;
  list: ListSearchResult['lists'][number] | undefined;
}) {
  const labels = new Map((list?.fields ?? []).map((f) => [f.key, f.label]));
  const answers = Object.entries({ ...e.answers, ...(e.erasable_answers ?? {}) });
  return (
    <article className="panel">
      <p className="m">
        {list?.title ?? 'A list'} · entry {String(e.id)}, {new Date(e.created_at).toLocaleString()}
      </p>
      <p className="m">
        {REVIEW[e.review_state]} · {TRIAGE[e.triage_state]} ·{' '}
        {e.personal_expires_at
          ? `the personal half is deleted on ${new Date(e.personal_expires_at).toLocaleDateString()}`
          : 'kept until its sender deletes it with their link'}
      </p>
      <dl className="dl">
        {e.email ? (
          <div>
            <dt>Email address</dt>
            <dd>{e.email}</dd>
          </div>
        ) : e.has_email ? (
          // Kept encrypted, so it is shown only when it is the one searched for.
          <div>
            <dt>Email address</dt>
            <dd>Given, and kept encrypted. Search for the address itself to match it.</dd>
          </div>
        ) : null}
        {answers.map(([k, v]) => (
          <div key={k}>
            <dt>{labels.get(k) ?? k}</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{said(v)}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
