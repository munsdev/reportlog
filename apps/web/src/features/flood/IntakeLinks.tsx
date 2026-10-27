/**
 * Organization intake links (Plan E, PE3): a manager makes a link for the
 * organization's volunteers. Whoever opens it, signed in, joins as a
 * coordinator and files for the organization while signed in. Each link has
 * a use limit and an off switch; a link switched off stays off.
 *
 * The link is shown once, when it is made: it is the credential, and only
 * its hash is kept.
 */
import {
  createIntakeLink,
  describeIntakeLink,
  disableIntakeLink,
  joinByIntakeLink,
  listIntakeLinks,
  listOrganizations,
} from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { Field } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { Narrow, TokenPage } from '../../mockup/Narrow.tsx';
import { Note, Panel } from '../../mockup/Panel.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { SignInPrompt } from '../identity/SignInPrompt.tsx';
import { useMe } from '../identity/session.ts';

const orgsQuery = queryOptions({
  queryKey: ['intake-links', 'orgs'],
  queryFn: ({ signal }) => call(listOrganizations, { signal }),
});
const linksQuery = (id: number) =>
  queryOptions({
    queryKey: ['intake-links', id],
    queryFn: ({ signal }) => call(listIntakeLinks, { params: { id: String(id) }, signal }),
  });

export function IntakeLinksPage() {
  const orgs = useQuery(orgsQuery);
  const managed = orgs.data?.organizations.filter((o) => o.role === 'manager') ?? [];
  return (
    <StaffPage
      area="Your organization"
      title="Volunteer links"
      lede="A link for your organization’s volunteers. Whoever opens it, signed in, joins as a coordinator and files for the organization. Each link works a set number of times, and you can switch it off."
    >
      {orgs.isPending ? <p role="status">Loading…</p> : null}
      {orgs.isError ? <Alert tone="serious">{orgs.error.message}</Alert> : null}
      {orgs.data && managed.length === 0 ? (
        <p>You do not manage an organization, so there are no links for you to make.</p>
      ) : null}
      {managed.map((o) => (
        <OrgLinks key={o.id} id={o.id} name={o.name} />
      ))}
    </StaffPage>
  );
}

function OrgLinks({ id, name }: { id: number; name: string }) {
  const qc = useQueryClient();
  const links = useQuery(linksQuery(id));
  const [label, setLabel] = useState('');
  const [uses, setUses] = useState('25');
  const make = useMutation({
    mutationFn: () =>
      call(createIntakeLink, {
        params: { id: String(id) },
        body: { label, max_uses: Number(uses) },
      }),
    onSuccess: async () => {
      setLabel('');
      await qc.invalidateQueries({ queryKey: ['intake-links', id] });
    },
  });
  const off = useMutation({
    mutationFn: (linkId: number) =>
      call(disableIntakeLink, { params: { id: String(id), linkId: String(linkId) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['intake-links', id] }),
  });
  return (
    <Card heading={name}>
      <form
        aria-label={`Make an intake link for ${name}`}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          make.mutate();
        }}
      >
        <Field className="flex-1">
          <Label>What it is for</Label>
          <Input
            value={label}
            required
            maxLength={120}
            onChange={(e) => {
              setLabel(e.target.value);
            }}
          />
        </Field>
        <Field>
          <Label>How many people may use it</Label>
          <Input
            type="number"
            min={1}
            max={10000}
            value={uses}
            onChange={(e) => {
              setUses(e.target.value);
            }}
          />
        </Field>
        <Button type="submit" disabled={make.isPending || !label.trim()}>
          Make the link
        </Button>
      </form>
      {make.isError ? <Alert tone="serious">{make.error.message}</Alert> : null}
      {make.data ? <NewLink url={make.data.url} /> : null}
      {links.data?.links.length ? (
        <ul className="flex flex-col gap-2 text-sm">
          {links.data.links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3">
              <span>
                {`${l.label} · used ${String(l.uses)} of ${String(l.max_uses)}`}
                {l.disabled_at ? ` · switched off ${new Date(l.disabled_at).toLocaleString()}` : ''}
              </span>
              {!l.disabled_at ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={off.isPending}
                  onClick={() => {
                    off.mutate(l.id);
                  }}
                >
                  {`Switch off: ${l.label}`}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {off.isError ? <Alert tone="serious">{off.error.message}</Alert> : null}
    </Card>
  );
}

/**
 * The new link, once (account.md §12): on the deep surface, not as a teal
 * "done" (teal is a moderator's confirmation), with a Copy button. The
 * link stays selectable text if the browser will not copy.
 */
function NewLink({ url }: { url: string }) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <Card variant="deep" heading="Copy the link now" headingLevel={3}>
      <code className="font-mono text-sm break-all">{url}</code>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            navigator.clipboard.writeText(url).then(
              () => {
                setSaid('Copied.');
              },
              () => {
                setSaid('This browser would not copy it. Select the link instead.');
              },
            );
          }}
        >
          Copy
        </Button>
        <span role="status" className="text-sm text-on-deep-muted">
          {said}
        </span>
      </div>
      <p className="text-on-deep-muted">
        Only this screen shows it. We keep a fingerprint of it, not the link. Anybody holding it can
        join until it is used up or switched off.
      </p>
    </Card>
  );
}

/**
 * What a volunteer opens (account.md §06). Nothing happens until they press
 * the button. Reading what the link offers needs somebody signed in, so a
 * visitor who is not is asked to sign in first and comes straight back.
 */
export function JoinPage({ token }: { token: string }) {
  useBodyClass('light', 'form');
  const me = useMe();
  const signedIn = me.data?.signedIn === true;
  const link = useQuery({
    queryKey: ['intake-links', 'describe', token],
    queryFn: ({ signal }) => call(describeIntakeLink, { params: { token }, signal }),
    enabled: signedIn,
    retry: false,
  });
  const join = useMutation({ mutationFn: () => call(joinByIntakeLink, { params: { token } }) });
  const loading = (
    <Narrow>
      <p role="status" className="muted">
        {me.isPending ? 'Loading…' : 'Checking this link…'}
      </p>
    </Narrow>
  );
  if (me.isPending) return loading;
  if (!signedIn) return <SignInPrompt next={`/organizations/join/${token}`} />;
  if (link.isPending) return loading;
  if (link.isError) {
    return (
      <TokenPage title="This link could not be checked">
        <p>{link.error.message}</p>
      </TokenPage>
    );
  }
  if (!link.data.usable) {
    return (
      <TokenPage title="This link does not work any more">
        <p>{link.data.why ?? 'It has been used up or switched off.'}</p>
      </TokenPage>
    );
  }
  if (join.data) {
    return (
      <TokenPage title="Welcome">
        <Note>
          {join.data.already_member
            ? `You are already in ${join.data.organization}.`
            : `You are now a coordinator of ${join.data.organization}.`}
        </Note>
        <p>
          <Link to="/intake">Go to intake</Link>
        </p>
      </TokenPage>
    );
  }
  return (
    <TokenPage title="Join an organization">
      <p>{`This link makes you a coordinator of ${link.data.organization}.`}</p>
      <Panel variant="quiet" title="A coordinator">
        <ul style={{ paddingLeft: 24, listStyle: 'disc' }}>
          <li>files accounts for {link.data.organization} while signed in;</li>
          <li>cannot manage it, or invite anybody;</li>
          <li>can leave at any time.</li>
        </ul>
      </Panel>
      <p className="m">You are signed in as {me.data?.signedIn ? me.data.email : ''}.</p>
      {join.isError ? <Note warn>{join.error.message}</Note> : null}
      <div>
        <button
          className="btn sm flat go"
          type="button"
          disabled={join.isPending}
          onClick={() => {
            join.mutate();
          }}
        >
          {join.isPending ? 'Joining…' : 'Join'}
        </button>
      </div>
    </TokenPage>
  );
}
