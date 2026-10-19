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
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { Field, FieldDescription } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
import { call } from '../../lib/api.ts';
import { REVIEW, TRIAGE, said } from './words.ts';

export function ListSearch() {
  const [q, setQ] = useState('');
  const search = useMutation({
    mutationFn: (words: string) => call(searchListEntries, { body: { q: words } }),
  });
  return (
    <Page
      title="Find somebody's entries"
      lede="For when somebody asks what this site holds about them. This looks through what people wrote on every list, and the email addresses they gave. Anything already deleted, by the timer or by its sender, is not found, because it is not kept."
      actions={
        <Button asChild variant="secondary">
          <Link to="/lists">All lists</Link>
        </Button>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          search.mutate(q);
        }}
      >
        <Field>
          <Label>Look for</Label>
          <Input
            type="search"
            value={q}
            maxLength={200}
            onChange={(e) => {
              setQ(e.target.value);
            }}
          />
          <FieldDescription>
            A name, an email address, or words they used. Put a phrase in quotes, use “or” for
            either of two, and a minus sign to leave a word out.
          </FieldDescription>
        </Field>
        <Button type="submit" disabled={search.isPending}>
          Search
        </Button>
      </form>
      {search.isPending ? <p role="status">Looking…</p> : null}
      {search.isError ? <Alert tone="serious">{search.error.message}</Alert> : null}
      {search.data ? <Results result={search.data} /> : null}
    </Page>
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
    <section className="space-y-3" aria-label="Entries found">
      <p role="status">
        {result.more
          ? `More than ${String(result.entries.length)} entries have “${result.query}” in them. The newest ${String(result.entries.length)} are shown; add words to narrow it.`
          : `${String(result.entries.length)} ${result.entries.length === 1 ? 'entry has' : 'entries have'} “${result.query}” in ${result.entries.length === 1 ? 'it' : 'them'}.`}
      </p>
      <ul className="space-y-3" aria-label="Entries">
        {result.entries.map((e) => (
          <li key={e.id}>
            <Found entry={e} list={lists.get(e.list_id)} />
          </li>
        ))}
      </ul>
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
    <Card>
      <CardContent className="space-y-2 pt-4">
        <p className="font-semibold">
          {list?.title ?? 'A list'} · entry {String(e.id)},{' '}
          {new Date(e.created_at).toLocaleString()}
        </p>
        <p className="text-sm text-ink-alt">
          {REVIEW[e.review_state]} · {TRIAGE[e.triage_state]} ·{' '}
          {e.personal_expires_at
            ? `the personal half is deleted on ${new Date(e.personal_expires_at).toLocaleDateString()}`
            : 'kept until its sender deletes it with their link'}
        </p>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          {e.email ? (
            <div className="contents">
              <dt className="font-semibold">Email address</dt>
              <dd className="break-all">{e.email}</dd>
            </div>
          ) : null}
          {answers.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-semibold">{labels.get(k) ?? k}</dt>
              <dd className="whitespace-pre-wrap break-words">{said(v)}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
