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
import { Field } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
import { call } from '../../lib/api.ts';
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
    <Page
      title="Volunteer links"
      lede="A link for your organization’s volunteers. Whoever opens it, signed in, joins as a coordinator and files for the organization. Each link works a set number of times, and you can switch it off."
      width="prose"
    >
      {orgs.isPending ? <p role="status">Loading…</p> : null}
      {orgs.isError ? <Alert tone="serious">{orgs.error.message}</Alert> : null}
      {orgs.data && managed.length === 0 ? (
        <p>You do not manage an organization, so there are no links for you to make.</p>
      ) : null}
      {managed.map((o) => (
        <OrgLinks key={o.id} id={o.id} name={o.name} />
      ))}
    </Page>
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
    <section
      aria-label={name}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
    >
      <h2 className="font-display text-xl font-bold">{name}</h2>
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
      {make.data ? (
        <Alert tone="confirmed" title="Copy the link now">
          <span>
            It is shown this once. Anybody holding it can join until it is used up or off.
          </span>
          <code className="break-all font-mono text-sm">{make.data.url}</code>
        </Alert>
      ) : null}
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
    </section>
  );
}

/** What a volunteer opens. Nothing happens until they press the button. */
export function JoinPage({ token }: { token: string }) {
  const me = useMe();
  const signedIn = me.data?.signedIn === true;
  const link = useQuery({
    queryKey: ['intake-links', 'describe', token],
    queryFn: ({ signal }) => call(describeIntakeLink, { params: { token }, signal }),
    enabled: signedIn,
    retry: false,
  });
  const join = useMutation({ mutationFn: () => call(joinByIntakeLink, { params: { token } }) });
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!signedIn) return <SignInPrompt next={`/organizations/join/${token}`} />;
  return (
    <Page title="Join an organization" width="prose">
      {link.isPending ? <p role="status">Reading the link…</p> : null}
      {link.isError ? <Alert>{link.error.message}</Alert> : null}
      {link.data && !link.data.usable ? <Alert>{link.data.why}</Alert> : null}
      {link.data?.usable && !join.data ? (
        <>
          <p>
            {`This link makes you a coordinator of ${link.data.organization}: you can file accounts for it while signed in. You cannot manage it, and you can leave at any time.`}
          </p>
          <Button
            type="button"
            className="self-start"
            disabled={join.isPending}
            onClick={() => {
              join.mutate();
            }}
          >
            {`Join ${link.data.organization}`}
          </Button>
        </>
      ) : null}
      {join.isError ? <Alert tone="serious">{join.error.message}</Alert> : null}
      {join.data ? (
        <Alert tone="confirmed">
          {join.data.already_member
            ? `You are already in ${join.data.organization}.`
            : `You are now a coordinator of ${join.data.organization}.`}{' '}
          <Link to="/intake" className="underline">
            Go to intake
          </Link>
        </Alert>
      ) : null}
    </Page>
  );
}
