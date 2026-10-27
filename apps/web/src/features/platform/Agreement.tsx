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
import { Note } from '@/mockup/NoteBox.tsx';
import { Btn } from '@/mockup/StaffBtn.tsx';
import { Panel } from '@/mockup/PanelBox.tsx';
import { Field, FieldDescription } from '@/mockup/FieldWired.tsx';
import { Label } from '@/mockup/FieldWired.tsx';
import { Page } from '../../components/ui/page.tsx';
import { ScrollX } from '../../components/ui/scroll-x.tsx';
import { Textarea } from '@/mockup/FieldWired.tsx';
import { call } from '../../lib/api.ts';
import { StaffPage } from '../nav/StaffPage.tsx';

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
      await client.invalidateQueries({ queryKey: ['desk'] });
    },
  });
  if (state.isPending) return <p role="status">Loading…</p>;
  if (state.isError) return <Note tone="serious">{state.error.message}</Note>;
  const { current, accepted } = state.data;
  if (!current || accepted) return children;
  return (
    <Page
      title="Read and accept the agreement"
      width="prose"
      lede={`Version ${String(current.version)}. You accept it before you ${audience === 'journalist' ? 'open the desk' : 'work on reports'}, and again whenever it changes.`}
    >
      <div className="rounded-card border border-line bg-surface p-5">
        <p className="whitespace-pre-wrap" data-agreement-text>
          {current.body}
        </p>
      </div>
      {accept.isError ? (
        <Note tone="serious" title="It was not recorded">
          {accept.error.message}
        </Note>
      ) : null}
      <div>
        <Btn
          type="button"
          disabled={accept.isPending}
          onClick={() => {
            accept.mutate(current.digest);
          }}
        >
          I have read this and I accept it
        </Btn>
      </div>
    </Page>
  );
}

export function AgreementAdminPage({
  audience,
  tabs,
}: {
  audience: AgreementAudience;
  /** A page's own tabs under the area's (the journalists' Requests and Agreement). */
  tabs?: ReactNode;
}) {
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
    <StaffPage
      title={audience === 'journalist' ? 'Journalist agreement' : 'Moderator agreement'}
      lede={`Every ${audience} accepts this before they can open the ${audience === 'journalist' ? 'desk' : 'queue'}. Publishing a new version asks everybody to accept it again.`}
    >
      {tabs}
      {state.data?.current ? (
        <Panel heading="The published version">
          <p className="font-mono text-sm text-muted">
            Version {String(state.data.current.version)}
          </p>
          <div className="rounded-control border border-line bg-paper p-5 text-ink">
            <p className="whitespace-pre-wrap">{state.data.current.body}</p>
          </div>
        </Panel>
      ) : (
        <Note title="No agreement is published">
          {audience === 'journalist'
            ? 'Until one is, the journalist desk stays closed.'
            : 'Until one is, nobody is asked to accept anything before moderating.'}
        </Note>
      )}
      <Panel heading="The new version">
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
            <FieldDescription>
              Plain text. It is shown exactly as written. Publishing it asks everybody to accept it
              again.
            </FieldDescription>
          </Field>
          {publish.isError ? <Note tone="serious">{publish.error.message}</Note> : null}
          {publish.isSuccess ? <Note tone="done">Published.</Note> : null}
          <Btn type="submit" className="self-start" disabled={publish.isPending}>
            Publish this version
          </Btn>
        </form>
      </Panel>
      <Panel heading="Who accepted">
        {accepted.data?.acceptances.length ? (
          <ScrollX label="Who accepted">
            <table className="data-table">
              <caption className="sr-only">Who accepted</caption>
              <thead>
                <tr>
                  <th scope="col">Who</th>
                  <th scope="col">Version</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {accepted.data.acceptances.map((a) => (
                  <tr key={`${a.user_email}-${String(a.version)}-${a.accepted_at}`}>
                    <td className="break-all">{a.user_email}</td>
                    <td>{String(a.version)}</td>
                    <td>{new Date(a.accepted_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        ) : (
          <p className="text-ink-alt">Nobody yet.</p>
        )}
      </Panel>
    </StaffPage>
  );
}
