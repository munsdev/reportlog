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
import { Btn } from '../../../mockup/Btn.tsx';
import { Note } from '../../../mockup/Note.tsx';
import { Problem } from '../../../mockup/Notice.tsx';
import { Panel } from '../../../mockup/Panel.tsx';
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

export function EvidenceRequests({
  threadId,
  bare = false,
}: {
  threadId: string;
  /** Inside a panel that already carries the heading (the report under moderation). */
  bare?: boolean;
}) {
  const qc = useQueryClient();
  const query = useQuery(evidenceQuery(threadId));
  const refresh = () => refreshStaffViews(qc);

  const body = (
    <>
      {query.isPending ? <p role="status">Reading…</p> : null}
      {query.isError ? <Problem>{query.error.message}</Problem> : null}
      {query.data ? (
        <>
          {query.data.open ? (
            <Note>
              <b>An ask is open.</b> Asked by {query.data.open.asked_by} on{' '}
              {when(query.data.open.asked_at)}. The link works until{' '}
              {when(query.data.open.expires_at)}. “{query.data.open.message}”
            </Note>
          ) : query.data.why_not ? (
            <p className="muted">{query.data.why_not}</p>
          ) : (
            <p className="muted">No ask is open.</p>
          )}

          <div className="acts">
            {query.data.askable ? (
              <AskDialog
                trigger={(open) => (
                  <Btn sm flat onClick={open}>
                    Ask for evidence…
                  </Btn>
                )}
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
                trigger={(open) => (
                  <Btn sm flat onClick={open}>
                    Withdraw the ask…
                  </Btn>
                )}
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
            <details className="tech">
              <summary>Every ask on this report ({String(query.data.history.length)})</summary>
              <div
                className="in"
                style={{ fontFamily: 'var(--rl-font-sans)', wordBreak: 'normal' }}
              >
                <ol aria-label="Every ask">
                  {query.data.history.map((a) => (
                    <li key={a.id}>
                      {when(a.asked_at)} by {a.asked_by}, {outcome(a)}
                      <span className="muted" style={{ display: 'block', whiteSpace: 'pre-wrap' }}>
                        “{a.message}”
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </>
  );
  return bare ? (
    <div className="col">{body}</div>
  ) : (
    <Panel title="Asking for evidence">{body}</Panel>
  );
}

/** One line on where asking for evidence stands, for a closed row. */
export function evidenceSummary(data: ResponseOf<typeof getEvidenceState> | undefined): string {
  if (!data) return 'Reading…';
  if (data.open)
    return `Asked ${when(data.open.asked_at)}; the link works until ${when(data.open.expires_at)}.`;
  const last = [...data.history].sort((a, b) => b.asked_at.localeCompare(a.asked_at))[0];
  if (last) return `Asked ${when(last.asked_at)}, ${outcome(last)}.`;
  return data.askable ? 'Not asked.' : `Not asked. ${data.why_not ?? ''}`.trim();
}
