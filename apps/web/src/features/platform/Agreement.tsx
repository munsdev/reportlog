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
import { Note } from '@/mockup/Note.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { Field, FieldDescription, Label, Textarea } from '@/mockup/Field.tsx';
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
    <StaffPage
      title="Read and accept the agreement"
      width="prose"
      lede={`Version ${String(current.version)}. You accept it before you ${audience === 'journalist' ? 'open the desk' : 'work on reports'}, and again whenever it changes.`}
    >
      <Panel>
        <p style={{ whiteSpace: 'pre-wrap' }} data-agreement-text>
          {current.body}
        </p>
      </Panel>
      {accept.isError ? (
        <Note tone="serious" title="It was not recorded">
          {accept.error.message}
        </Note>
      ) : null}
      <div>
        <Btn
          look="ink"
          sm
          flat
          type="button"
          disabled={accept.isPending}
          onClick={() => {
            accept.mutate(current.digest);
          }}
        >
          I have read this and I accept it
        </Btn>
      </div>
    </StaffPage>
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
        <Panel title="The published version">
          <p className="m">Version {String(state.data.current.version)}</p>
          <div className="paper">
            <p style={{ whiteSpace: 'pre-wrap' }}>{state.data.current.body}</p>
          </div>
        </Panel>
      ) : (
        <Note title="No agreement is published">
          {audience === 'journalist'
            ? 'Until one is, the journalist desk stays closed.'
            : 'Until one is, nobody is asked to accept anything before moderating.'}
        </Note>
      )}
      <Panel title="The new version">
        <form
          className="form-stack"
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
          <div className="acts">
            <Btn look="ink" sm flat type="submit" disabled={publish.isPending}>
              Publish this version
            </Btn>
          </div>
        </form>
      </Panel>
      <Panel title="Who accepted">
        {accepted.data?.acceptances.length ? (
          <div className="rows tbl" role="table" aria-label="Who accepted">
            <div className="row head" role="row">
              <span role="columnheader">Who</span>
              <span role="columnheader">Version</span>
              <span role="columnheader">When</span>
            </div>
            {accepted.data.acceptances.map((a) => (
              <div
                className="row"
                role="row"
                key={`${a.user_email}-${String(a.version)}-${a.accepted_at}`}
              >
                <span data-l="Who" role="cell">
                  {a.user_email}
                </span>
                <span data-l="Version" role="cell">
                  {String(a.version)}
                </span>
                <span data-l="When" role="cell">
                  {new Date(a.accepted_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Nobody yet.</p>
        )}
      </Panel>
    </StaffPage>
  );
}
