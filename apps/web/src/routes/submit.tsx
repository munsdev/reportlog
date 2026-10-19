/**
 * Where the front page's built-in "Submit a Report" goes: a choice of the
 * logbooks taking reports now. Every report is filed through a logbook, so
 * with one open this goes straight to its form, and with none it says so
 * rather than showing an empty list.
 */
import { listPublicLogbooks } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link, Navigate, createFileRoute } from '@tanstack/react-router';
import { CopyText } from '../components/ui/copy-text.tsx';
import { Page } from '../components/ui/page.tsx';
import { call } from '../lib/api.ts';

const openLogbooksQuery = queryOptions({
  queryKey: ['logbooks', 'public', 'open'],
  queryFn: ({ signal }) => call(listPublicLogbooks, { query: { include: 'open' }, signal }),
});

export const Route = createFileRoute('/submit')({
  component: Submit,
});

function Submit() {
  const list = useQuery(openLogbooksQuery);
  if (list.isPending) return <p role="status">Loading…</p>;
  if (list.isError) return <p role="alert">{list.error.message}</p>;
  const open = list.data.logbooks;
  const only = open.length === 1 ? open[0] : undefined;
  if (only) return <Navigate to="/file/$slug" params={{ slug: only.slug }} replace />;
  return (
    <Page title="What are you reporting?" width="prose">
      <CopyText slot="submit_intro" />
      {open.length === 0 ? (
        <p>Nothing is taking reports at the moment. Please come back later.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {open.map((l) => (
            <li key={l.slug} className="rounded-card border border-line bg-surface p-4">
              <Link to="/file/$slug" params={{ slug: l.slug }} className="font-semibold underline">
                {l.title}
              </Link>
              {l.blurb ? <p className="text-ink-alt">{l.blurb}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
