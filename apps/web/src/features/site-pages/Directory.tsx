/**
 * The directory of organizations that asked to be listed, and an
 * organization's own switch for it.
 *
 * The disclaimer comes from the server WITH the rows and is shown above them:
 * a page that showed the list without the sentence saying what it is not
 * would make, on the site's behalf, exactly the claim the site refuses to
 * make. Ranked by members alone, never by reports.
 *
 * No logos yet: they need file storage, which another workstream is building.
 */
import { getDirectory, getListing, setListing } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { Page } from '../../components/ui/page.tsx';
import { call } from '../../lib/api.ts';
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
      <Alert tone="serious" title="The directory could not be loaded.">
        {dir.error.message}
      </Alert>
    );
  }
  return (
    <Page title={dir.data.name} width="prose">
      <Alert tone="note" title="What this list is">
        {dir.data.disclaimer}
      </Alert>
      {dir.data.organizations.length === 0 ? (
        <p>No organization has asked to be listed yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {dir.data.organizations.map((o) => (
            <li key={o.name}>
              <Card>
                <CardContent className="flex flex-col gap-1">
                  <h2 className="font-display text-lg font-bold">{o.name}</h2>
                  {o.details ? <p>{o.details}</p> : null}
                  <p className="text-sm text-ink-alt">
                    {people(o.member_count)} · listed since {day(o.joined)}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </Page>
  );
}

export function ListingPage({ id }: { id: number }) {
  const me = useMe();
  const client = useQueryClient();
  const key = ['directory', 'listing', id];
  const state = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => call(getListing, { params: { id }, signal }),
    enabled: me.data?.signedIn === true,
  });
  const change = useMutation({
    mutationFn: (listed: boolean) => call(setListing, { params: { id }, body: { listed } }),
    onSuccess: (data) => {
      client.setQueryData(key, data);
      void client.invalidateQueries({ queryKey: ['directory'] });
    },
  });
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next={`/organizations/${String(id)}/listing`} />;
  if (state.isError) {
    return (
      <Alert tone="serious" title="This could not be opened.">
        {state.error.message}
      </Alert>
    );
  }
  if (!state.data) return <p role="status">Loading…</p>;
  const s = state.data;
  return (
    <Page title={`${s.organization} in the directory`} width="prose">
      <p>
        {s.listed
          ? `${s.organization} is listed in “${s.directory_name}”${s.joined ? `, since ${day(s.joined)}` : ''}.`
          : `${s.organization} is not listed in “${s.directory_name}”.`}
      </p>
      <section className="flex flex-col gap-2" aria-labelledby="appears">
        <h2 id="appears" className="font-display text-xl font-bold">
          What appears publicly while it is listed
        </h2>
        <ul className="list-disc pl-6">
          {s.what_appears.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <p className="text-sm text-ink-alt">Today that number would be {String(s.member_count)}.</p>
      </section>
      <Alert tone="note" title="Shown above the list">
        {s.disclaimer}
      </Alert>
      <p>{s.leaving}</p>
      {change.isError ? (
        <Alert tone="serious" title="That did not change.">
          {change.error.message}
        </Alert>
      ) : null}
      <div>
        <Button
          variant={s.listed ? 'secondary' : 'primary'}
          disabled={change.isPending}
          onClick={() => {
            change.mutate(!s.listed);
          }}
        >
          {s.listed ? 'Take it out of the directory' : 'List it in the directory'}
        </Button>
      </div>
    </Page>
  );
}
