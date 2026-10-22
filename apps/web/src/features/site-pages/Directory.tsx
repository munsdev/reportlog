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
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { CopyText } from '../../components/ui/copy-text.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { Field } from '../../components/ui/field.tsx';
import { Label } from '../../components/ui/label.tsx';
import { RadioGroup, RadioOption } from '../../components/ui/radio-group.tsx';
import { ToastProvider, useToast } from '../../components/ui/toast.tsx';
import { Meta } from '../../components/ui/type.tsx';
import { PublicPage } from './PublicPage.tsx';
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
      <PublicPage title="Organizations" width="prose">
        <Alert tone="serious" title="The directory could not be loaded.">
          {dir.error.message}
        </Alert>
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
  const value = chosen ?? (s.listed ? 'listed' : 'not');
  const changed = (value === 'listed') !== s.listed;
  return (
    <PublicPage title={`${s.organization} in the directory`} width="prose">
      <p>
        {s.listed
          ? `${s.organization} is listed in “${s.directory_name}”${s.joined ? `, since ${day(s.joined)}` : ''}.`
          : `${s.organization} is not listed in “${s.directory_name}”.`}
      </p>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate(value === 'listed');
        }}
      >
        <Field>
          <Label>In the directory</Label>
          <RadioGroup
            value={value}
            onValueChange={(v) => {
              setChosen(v === 'listed' ? 'listed' : 'not');
            }}
          >
            <RadioOption value="listed" label="Listed" hint="Its row appears as shown below." />
            <RadioOption value="not" label="Not listed" hint={s.leaving} />
          </RadioGroup>
        </Field>
        <section className="flex flex-col gap-3" aria-labelledby="appears">
          <h2 id="appears" className="label-face text-xs text-ink-alt">
            How its row appears while it is listed
          </h2>
          <Card variant="quiet" heading="What this list is">
            <p className="whitespace-pre-wrap">{s.disclaimer}</p>
          </Card>
          <ul className="list-disc pl-6">
            {s.what_appears.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="text-sm text-ink-alt">
            Today its number of members would be {String(s.member_count)}.
          </p>
        </section>
        {change.isError ? (
          <Alert tone="serious" title="That did not change.">
            {change.error.message}
          </Alert>
        ) : null}
        <div className="flex flex-col items-start gap-2">
          <Button
            type="submit"
            disabled={!changed}
            busy={change.isPending}
            busyLabel="Saving…"
            aria-describedby={changed ? undefined : 'listing-unchanged'}
          >
            Save
          </Button>
          {changed ? null : (
            <p id="listing-unchanged" className="text-sm text-ink-alt">
              Nothing changed yet.
            </p>
          )}
        </div>
      </form>
    </PublicPage>
  );
}
