/**
 * The directory of organizations that asked to be listed, and an
 * organization's own switch for it.
 *
 * The disclaimer comes from the server WITH the rows and is shown above them:
 * a page that showed the list without the sentence saying what it is not
 * would make, on the site's behalf, exactly the claim the site refuses to
 * make. Ranked by members alone, never by reports.
 *
 * A logo, when an organization has one, is served from the site itself
 * (identity keeps it, through the files workstream's storage). It sits beside
 * the name, so it is decoration to a screen reader: the name says who it is.
 */
import { getDirectory, getListing, setListing } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Card } from '../../components/ui/card.tsx';
import { CopyText } from '../../components/ui/copy-text.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { ToastProvider, useToast } from '../../components/ui/toast.tsx';
import { Meta } from '../../components/ui/type.tsx';
import { PublicPage } from './PublicPage.tsx';
import { call } from '../../lib/api.ts';
import { Narrow, TokenPage } from '../../mockup/Narrow.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { useMe } from '../identity/session.ts';
import { SignInPrompt } from '../identity/SignInPrompt.tsx';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
const people = (n: number) => (n === 1 ? '1 member' : `${String(n)} members`);

export function DirectoryPage() {
  const dir = useQuery({
    queryKey: ['directory'],
    queryFn: ({ signal }) => call(getDirectory, { signal }),
  });
  if (dir.isPending) return <p role="status">Loading…</p>;
  if (dir.isError) {
    return (
      <PublicPage title="Organizations" width="prose">
        <Note tone="serious" title="The directory could not be loaded.">
          {dir.error.message}
        </Note>
      </PublicPage>
    );
  }
  return (
    <PublicPage title={dir.data.name} width="prose">
      <CopyText slot="alliance_intro" />
      {/* Always above the rows: the list without it would make the claim
          the site refuses to make. */}
      <Card variant="quiet" heading="What this list is">
        <p className="whitespace-pre-wrap">{dir.data.disclaimer}</p>
      </Card>
      {dir.data.organizations.length === 0 ? (
        <Empty title="Nobody listed yet">No organization has asked to be listed yet.</Empty>
      ) : (
        <ol className="flex flex-col gap-5" aria-label="Organizations, by members">
          {dir.data.organizations.map((o) => (
            <li key={o.name}>
              <OrganizationRow
                name={o.name}
                logo={o.logo}
                details={o.details}
                line={`${people(o.member_count)} · listed since ${day(o.joined)}`}
              />
            </li>
          ))}
        </ol>
      )}
    </PublicPage>
  );
}

/** One organization as the directory shows it; the listing page previews the same. */
function OrganizationRow({
  name,
  logo,
  details,
  line,
}: {
  name: string;
  logo?: string | null | undefined;
  details?: string | null | undefined;
  line: string;
}) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        {logo ? (
          <img
            src={logo}
            alt=""
            className="size-12 shrink-0 rounded-control border border-line object-contain"
          />
        ) : null}
        <h2 className="font-display text-xl">{name}</h2>
      </div>
      {details ? <p className="max-w-prose whitespace-pre-wrap">{details}</p> : null}
      <Meta>{line}</Meta>
    </Card>
  );
}

export function ListingPage({ id }: { id: number }) {
  return (
    <ToastProvider>
      <Listing id={id} />
    </ToastProvider>
  );
}

function Listing({ id }: { id: number }) {
  useBodyClass('light', 'form');
  const me = useMe();
  const client = useQueryClient();
  const toast = useToast();
  const key = ['directory', 'listing', id];
  const state = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => call(getListing, { params: { id }, signal }),
    enabled: me.data?.signedIn === true,
  });
  const [chosen, setChosen] = useState<'listed' | 'not' | null>(null);
  const change = useMutation({
    mutationFn: (listed: boolean) => call(setListing, { params: { id }, body: { listed } }),
    onSuccess: (data) => {
      client.setQueryData(key, data);
      void client.invalidateQueries({ queryKey: ['directory'] });
      setChosen(null);
      toast.show(
        data.listed
          ? `${data.organization} is listed in the directory now.`
          : `${data.organization} is out of the directory now.`,
      );
    },
  });
  if (me.isPending) {
    return (
      <Narrow>
        <p role="status" className="muted">
          Loading…
        </p>
      </Narrow>
    );
  }
  if (!me.data?.signedIn) return <SignInPrompt next={`/organizations/${String(id)}/listing`} />;
  if (state.isError) {
    return (
      <TokenPage title="This could not be opened.">
        <Note warn>{state.error.message}</Note>
      </TokenPage>
    );
  }
  if (!state.data) {
    return (
      <Narrow>
        <p role="status" className="muted">
          Loading…
        </p>
      </Narrow>
    );
  }
  const s = state.data;
  const value = chosen ?? (s.listed ? 'listed' : 'not');
  const changed = (value === 'listed') !== s.listed;
  return (
    <TokenPage title={`${s.organization} in the directory`}>
      <p>
        {s.listed
          ? `${s.organization} is listed in “${s.directory_name}”${s.joined ? `, since ${day(s.joined)}` : ''}.`
          : `${s.organization} is not listed in “${s.directory_name}”.`}
      </p>
      <form
        style={{ display: 'grid', gap: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate(value === 'listed');
        }}
      >
        <div className="switch">
          <div>
            <b id="listing-label">Listed in the directory</b>
            <span>{value === 'listed' ? 'Its row appears as shown below.' : s.leaving}</span>
          </div>
          <button
            className="tgl"
            type="button"
            role="switch"
            aria-checked={value === 'listed'}
            aria-labelledby="listing-label"
            onClick={() => {
              setChosen(value === 'listed' ? 'not' : 'listed');
            }}
          />
        </div>
        <Panel kind="quiet" title="What this list is">
          <p className="whitespace-pre-wrap">{s.disclaimer}</p>
        </Panel>
        <section aria-labelledby="appears" style={{ display: 'grid', gap: 10 }}>
          <h2 id="appears" className="eyebrow">
            How its row appears while it is listed
          </h2>
          <ul style={{ paddingLeft: 24, listStyle: 'disc' }}>
            {s.what_appears.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="m">Today its number of members would be {String(s.member_count)}.</p>
        </section>
        {change.isError ? (
          <Note warn title="That did not change.">
            {change.error.message}
          </Note>
        ) : null}
        <div>
          <button
            className="btn sm flat ink"
            type="submit"
            disabled={!changed || change.isPending}
            aria-describedby={changed ? undefined : 'listing-unchanged'}
          >
            {change.isPending ? 'Saving…' : 'Save'}
          </button>
          {changed ? null : (
            <p id="listing-unchanged" className="m">
              Nothing changed yet.
            </p>
          )}
        </div>
      </form>
    </TokenPage>
  );
}
