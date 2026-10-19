/**
 * Asking a reporter for the evidence they said they had, and withdrawing an
 * ask. Built to be dropped into the moderation screen (workstream D1) too:
 *
 *   <EvidenceRequests threadId={thread} />
 *
 * AN ASK NEEDS TWO YESES from the reporter: the sealed answer saying they
 * have evidence, and their revocable permission to be asked. The server says
 * which is missing; the screen shows its sentence and offers no button.
 *
 * THE MESSAGE GOES TO A MEMBER OF THE PUBLIC word for word, under the
 * archive's name, so it is required and typed: a request for photographs
 * with no words reads like a phishing mail.
 */
import { askForEvidence, cancelEvidenceAsk } from '@reportlog/contracts';
import type { ResponseOf, getEvidenceState } from '@reportlog/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from '../../../components/ui/alert.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { call } from '../../../lib/api.ts';
import { AskDialog } from './AskDialog.tsx';
import { evidenceQuery, refreshStaffViews } from './queries.ts';

type Ask = ResponseOf<typeof getEvidenceState>['history'][number];

const when = (t: string) => new Date(t).toLocaleString();

function outcome(a: Ask): string {
  if (a.used_at) return `answered ${when(a.used_at)}`;
  if (a.cancelled_at) return `withdrawn ${when(a.cancelled_at)}`;
  if (a.expired_at) return `expired ${when(a.expired_at)}`;
  return `open until ${when(a.expires_at)}`;
}

export function EvidenceRequests({ threadId }: { threadId: string }) {
  const qc = useQueryClient();
  const query = useQuery(evidenceQuery(threadId));
  const refresh = () => refreshStaffViews(qc);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="evidence-heading">
      <h2 id="evidence-heading" className="font-display text-2xl font-bold">
        Asking for evidence
      </h2>
      {query.isPending ? <p role="status">Reading…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? (
        <>
          {query.data.open ? (
            <Alert title="An ask is open">
              <p>
                Asked by {query.data.open.asked_by} on {when(query.data.open.asked_at)}. The link
                works until {when(query.data.open.expires_at)}.
              </p>
              <p className="mt-2 whitespace-pre-wrap">“{query.data.open.message}”</p>
            </Alert>
          ) : query.data.why_not ? (
            <p>{query.data.why_not}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {query.data.askable ? (
              <AskDialog
                trigger={<Button>Ask for evidence…</Button>}
                title="Ask the reporter for evidence"
                description="They are emailed a link to send files. The link works for two weeks, once."
                questions={[
                  {
                    label: 'What are you asking them for?',
                    hint: 'This goes to them word for word, in an email that names no moderator and carries none of their report. Say what you need and why it would help.',
                    multiline: true,
                    min: 10,
                    max: 5000,
                    tooShort: 'Write at least a sentence: the reporter reads exactly this.',
                  },
                ]}
                finish="Send the ask"
                onFinish={async ([message]) => {
                  await call(askForEvidence, {
                    params: { threadId },
                    body: { message: message ?? '' },
                  });
                  await refresh();
                }}
              />
            ) : null}
            {query.data.open ? (
              <AskDialog
                trigger={<Button variant="secondary">Withdraw the ask…</Button>}
                title="Withdraw the ask"
                description="The link stops working straight away. The record of having asked stays, and you can ask again afterwards."
                questions={[]}
                finish="Withdraw it"
                onFinish={async () => {
                  await call(cancelEvidenceAsk, { params: { threadId } });
                  await refresh();
                }}
              />
            ) : null}
          </div>

          {query.data.history.length ? (
            <details>
              <summary className="cursor-pointer text-sm font-semibold">
                Every ask on this report ({String(query.data.history.length)})
              </summary>
              <ol className="mt-2 flex flex-col gap-2 text-sm" aria-label="Every ask">
                {query.data.history.map((a) => (
                  <li key={a.id}>
                    {when(a.asked_at)} by {a.asked_by}, {outcome(a)}
                    <span className="block whitespace-pre-wrap text-ink-alt">“{a.message}”</span>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
