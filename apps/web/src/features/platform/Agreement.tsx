/**
 * The agreement a person accepts before they act (M8): the gate in front of
 * the moderation screens, and the administrator's page to publish a new
 * version and see who has accepted it.
 *
 * Generic over the audience, so the journalist desk uses the same gate with
 * its own word. Accepting names the exact words that were on screen (their
 * digest), so a text that changed while somebody was reading is read again.
 */
import {
  acceptAgreement,
  getAgreement,
  listAgreementAcceptances,
  publishAgreement,
} from '@reportlog/contracts';
import type { AgreementAudience } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Field, FieldDescription } from '../../components/ui/field.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { call } from '../../lib/api.ts';

export const agreementQuery = (audience: AgreementAudience) =>
  queryOptions({
    queryKey: ['agreement', audience],
    queryFn: ({ signal }) => call(getAgreement, { params: { audience }, signal }),
  });

export function AgreementGate({
  audience,
  children,
}: {
  audience: AgreementAudience;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const state = useQuery(agreementQuery(audience));
  const accept = useMutation({
    mutationFn: (digest: string) =>
      call(acceptAgreement, { params: { audience }, body: { digest } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['agreement', audience] });
      // Whatever was refused while it was unaccepted can be asked again.
      await client.invalidateQueries({ queryKey: ['moderation'] });
    },
  });
  if (state.isPending) return <p role="status">Loading…</p>;
  if (state.isError) return <Alert tone="serious">{state.error.message}</Alert>;
  const { current, accepted } = state.data;
  if (!current || accepted) return children;
  return (
    <Page
      title="Read and accept the agreement"
      width="prose"
      lede={`Version ${String(current.version)}. You accept it before you work on reports, and again whenever it changes.`}
    >
      <div className="rounded-card border border-line bg-surface p-5">
        <p className="whitespace-pre-wrap" data-agreement-text>
          {current.body}
        </p>
      </div>
      {accept.isError ? (
        <Alert tone="serious" title="It was not recorded">
          {accept.error.message}
        </Alert>
      ) : null}
      <div>
        <Button
          type="button"
          disabled={accept.isPending}
          onClick={() => {
            accept.mutate(current.digest);
          }}
        >
          I have read this and I accept it
        </Button>
      </div>
    </Page>
  );
}

export function AgreementAdminPage({ audience }: { audience: AgreementAudience }) {
  const client = useQueryClient();
  const state = useQuery(agreementQuery(audience));
  const accepted = useQuery(
    queryOptions({
      queryKey: ['agreement', audience, 'acceptances'],
      queryFn: ({ signal }) => call(listAgreementAcceptances, { params: { audience }, signal }),
    }),
  );
  const [body, setBody] = useState('');
  const publish = useMutation({
    mutationFn: () => call(publishAgreement, { params: { audience }, body: { body } }),
    onSuccess: async () => {
      setBody('');
      await client.invalidateQueries({ queryKey: ['agreement', audience] });
    },
  });
  return (
    <Page
      title="Moderator agreement"
      lede="The words every moderator accepts before they work on reports. Publishing a new version asks everybody to accept it again; the old versions and who accepted them stay on the record."
    >
      {state.data?.current ? (
        <div className="rounded-card border border-line bg-surface p-5">
          <h2 className="font-display text-xl font-bold">
            Current: version {String(state.data.current.version)}
          </h2>
          <p className="mt-2 whitespace-pre-wrap">{state.data.current.body}</p>
        </div>
      ) : (
        <Alert title="No agreement is published">
          Until one is, nobody is asked to accept anything before moderating.
        </Alert>
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          publish.mutate();
        }}
      >
        <Field>
          <Label>The new version</Label>
          <Textarea
            rows={10}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
            }}
          />
          <FieldDescription>Plain text. It is shown exactly as written.</FieldDescription>
        </Field>
        {publish.isError ? <Alert tone="serious">{publish.error.message}</Alert> : null}
        {publish.isSuccess ? <Alert tone="confirmed">Published.</Alert> : null}
        <Button type="submit" className="self-start" disabled={publish.isPending}>
          Publish this version
        </Button>
      </form>
      <section aria-label="Who accepted" className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-bold">Who accepted</h2>
        {accepted.data?.acceptances.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {accepted.data.acceptances.map((a) => (
              <li key={`${a.user_email}-${String(a.version)}-${a.accepted_at}`}>
                {a.user_email} · version {String(a.version)} ·{' '}
                {new Date(a.accepted_at).toLocaleString()}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-alt">Nobody yet.</p>
        )}
      </section>
    </Page>
  );
}
