/**
 * Standards: the written rules anybody can hold this site to, one tab each,
 * so another standard can join as a tab later. The selected tab is in the
 * address (`?tab=`) so a link can point at one; /standards alone is the
 * moderation standard, as every older link expects.
 *
 *   Moderation    what gets published, what is held back, and who decides:
 *                 the operator's words (`standards`). Until written, the
 *                 shipped wording says plainly it is not a standard yet.
 *   Journalists   the journalist agreement as published by the owner, read
 *                 only, so somebody can read it before asking for desk
 *                 access (GET /api/standards/journalist). Accepting it is
 *                 still the desk's, for an approved journalist.
 */
import { getJournalistStandard, getModerationStandard } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Note } from '@/mockup/Note.tsx';
import { CopyText } from '../components/ui/copy-text.tsx';
import { useSite } from '../components/ui/site.tsx';
import { PublicPage } from '../features/site-pages/PublicPage.tsx';
import { call } from '../lib/api.ts';

const TABS = [
  { id: 'moderation', label: 'Moderation' },
  { id: 'journalists', label: 'Journalists' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export const Route = createFileRoute('/standards')({
  validateSearch: (s: Record<string, unknown>): { tab?: TabId } => {
    const tab = TABS.find((t) => t.id === s.tab)?.id;
    return tab && tab !== 'moderation' ? { tab } : {};
  },
  component: StandardsPage,
});

const LEDE: Record<TabId, string> = {
  moderation: 'What gets published here, what is held back, and who decides.',
  journalists: 'What a journalist agrees to before the journalist desk opens to them.',
};

function StandardsPage() {
  const tab = Route.useSearch().tab ?? 'moderation';
  return (
    <PublicPage variant="band" title="Standards" eyebrow="Legal" width="prose" lede={LEDE[tab]}>
      <nav className="tabs tabs-filled" aria-label="Standards">
        {TABS.map((t) => (
          <Link
            key={t.id}
            to="/standards"
            search={t.id === 'moderation' ? {} : { tab: t.id }}
            replace
            activeProps={{}}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === 'moderation' ? <Moderation /> : <Journalists />}
    </PublicPage>
  );
}

/** "Version 2, published 28 October 2026.", as both standards say it. */
function Published({ version, at }: { version: number; at: string }) {
  return (
    <p className="m">
      Version {version}, published{' '}
      {new Date(at).toLocaleDateString(undefined, { dateStyle: 'long' })}.
    </p>
  );
}

function Moderation() {
  const site = useSite();
  const info = useQuery({
    queryKey: ['standards', 'moderation'],
    queryFn: ({ signal }) => call(getModerationStandard, { signal }),
  });
  const current = info.data?.current;
  return (
    <>
      <h2>Moderation standard</h2>
      {current ? <Published version={current.version} at={current.published_at} /> : null}
      {info.data && !current ? (
        <p className="m">The wording this software ships with, until this site writes its own.</p>
      ) : null}
      {site.isPending ? <p role="status">Loading…</p> : null}
      {site.isError ? (
        <Note tone="serious" title="The standard could not be loaded">
          {site.error.message}
        </Note>
      ) : null}
      <CopyText slot="standards" />
      <p className="m">
        Holding a report back is not a finding that it is false, and publishing one is not a finding
        that it is true. A moderator judges whether an account may be published, nothing more.
      </p>
    </>
  );
}

function Journalists() {
  const standard = useQuery({
    queryKey: ['standards', 'journalist'],
    queryFn: ({ signal }) => call(getJournalistStandard, { signal }),
  });
  const current = standard.data?.current;
  return (
    <>
      <h2>Journalist standard</h2>
      {standard.isPending ? <p role="status">Loading…</p> : null}
      {standard.isError ? (
        <Note tone="serious" title="The standard could not be loaded">
          {standard.error.message}
        </Note>
      ) : null}
      {standard.data && !current ? (
        <p>
          No journalist standard has been published yet. Until one is, the desk does not open to
          anybody.
        </p>
      ) : null}
      {current ? (
        <>
          <Published version={current.version} at={current.published_at} />
          <p style={{ whiteSpace: 'pre-wrap' }}>{current.body}</p>
        </>
      ) : null}
      <p className="m">
        An approved journalist accepts this before the desk opens to them, and again whenever it
        changes. <Link to="/journalists">Ask for desk access</Link>
      </p>
    </>
  );
}
