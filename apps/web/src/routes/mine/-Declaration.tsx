/**
 * The signed declaration, printed from "My reports" (legacy's "Print / sign
 * PDF"): the report's answers under the questions the reporter read, what to
 * do with the paper, a declaration under 28 U.S.C. § 1746 in the words for
 * signing inside or outside the United States, the lines to sign, and the
 * fingerprint of the exact sealed version it declares.
 *
 * NOTHING HERE IS SENT ANYWHERE. The name and the place are typed into this
 * page, printed, and forgotten: a name is exactly what the archive does not
 * keep. Printing happens in the browser, as a PDF if the reporter chooses.
 *
 * The page prints only the declaration: it is marked `data-print-only`, and
 * the site's print rules (styles.css) then hide everything else on the page,
 * the header included. Printed, it is set in the theme's body face at 11pt
 * (account.md §09).
 */
import { getMyReport } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link, useLocation } from '@tanstack/react-router';
import { useState } from 'react';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { rawFromAnswers, shownAnswer } from '@/features/form/walk.ts';
import { SignInPrompt } from '@/features/identity/SignInPrompt.tsx';
import { useMe } from '@/features/identity/session.ts';
import { call } from '@/lib/api.ts';
import { Back } from '../../mockup/Back.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { Choice, Choices } from '../../mockup/Choice.tsx';
import { TextField } from '@/mockup/Field.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Panel } from '@/mockup/Panel.tsx';

// The same key as "My reports" uses for this report, so the two share it.
const reportQuery = (threadId: string) =>
  queryOptions({
    queryKey: ['mine', 'reports', threadId],
    queryFn: ({ signal }) => call(getMyReport, { params: { threadId }, signal }),
    retry: false,
  });

/** Kept from the old application, word for word: they are the legal words. */
const DECLARATION = {
  in: 'I declare under penalty of perjury that the foregoing is true and correct.',
  out: 'I declare under penalty of perjury under the laws of the United States of America that the foregoing is true and correct.',
} as const;

const BLANK = '________________________';

export function DeclarationPage({ threadId }: { threadId: string }) {
  const me = useMe();
  const { pathname } = useLocation();
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next={pathname} />;
  return <Declaration threadId={threadId} />;
}

function Declaration({ threadId }: { threadId: string }) {
  const report = useQuery(reportQuery(threadId));
  const site = plainSiteName(useSite().data);
  const [name, setName] = useState('');
  const [place, setPlace] = useState('');
  const [where, setWhere] = useState<'in' | 'out'>('in');

  if (report.isPending) return <p role="status">Loading…</p>;
  if (report.isError) {
    return (
      <StaffPage title="Not one of your reports" width="prose">
        <p>{report.error.message}</p>
        <Link to="/mine">Back to your reports</Link>
      </StaffPage>
    );
  }
  const r = report.data;
  const raw = rawFromAnswers(r.questions, r.answers);
  const answered = r.questions.filter((q) => r.answers[q.key] !== undefined);

  return (
    <StaffPage
      area="Account"
      title="A signed declaration"
      lede="Print your report as a statement you sign, for a lawyer or an organization that asks for one."
    >
      <Back to={`/mine/${threadId}`}>Back to the report</Back>
      <div className="grid2">
        <div className="col">
          <Panel title="Your details">
            <Note>
              <b>Nothing you type here is sent anywhere.</b>
            </Note>
            {r.versions > 1 ? (
              <Note>
                <b>This is the newest version.</b> It declares what the report says now, after{' '}
                {String(r.versions - 1)} {r.versions === 2 ? 'correction' : 'corrections'}.
              </Note>
            ) : null}
            <TextField
              label="Your full name"
              help="Printed under the signature line. Leave it empty to write it by hand."
              value={name}
              autoComplete="name"
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
            <TextField
              label="Where you will sign it"
              help="A city and country. Leave it empty to write it by hand."
              value={place}
              onChange={(e) => {
                setPlace(e.target.value);
              }}
            />
            <span className="lbl" id="signing-where">
              Will you sign it in the United States?
            </span>
            <div role="radiogroup" aria-labelledby="signing-where">
              <Choices>
                <Choice
                  name="us"
                  checked={where === 'in'}
                  onChange={() => {
                    setWhere('in');
                  }}
                >
                  In the United States
                </Choice>
                <Choice
                  name="us"
                  checked={where === 'out'}
                  onChange={() => {
                    setWhere('out');
                  }}
                >
                  Outside the United States
                </Choice>
              </Choices>
            </div>
            <Btn sm flat
              look="ink"
              onClick={() => {
                window.print();
              }}
            >
              Print it or save it as a PDF
            </Btn>
          </Panel>
        </div>
        <div className="col">
          {/* The document as it will print: the paper alone, no edge, set at 11pt. */}
          <style>{'@media print{.paper{border:0;box-shadow:none;padding:0;font-size:11pt}}'}</style>
          <section
            id="declaration"
            data-print-only
            aria-labelledby="declaration-title"
            className="paper"
          >
            <h2 id="declaration-title">The declaration</h2>
            <p>
              <b>{site}: witness statement</b>
            </p>
            <dl className="dl">
              <div>
                <dt>Reference</dt>
                <dd className="mono">{r.public_ref}</dd>
              </div>
              <div>
                <dt>Logbook</dt>
                <dd>{r.logbook_title}</dd>
              </div>
              <div>
                <dt>Filed</dt>
                <dd>{new Date(r.first_received_at).toLocaleString()}</dd>
              </div>
              {r.versions > 1 ? (
                <div>
                  <dt>This version</dt>
                  <dd>{new Date(r.received_at).toLocaleString()}</dd>
                </div>
              ) : null}
            </dl>
            {/* The report is its answers, each under the question the reporter read, in the logbook's order. */}
            {answered.map((q) => (
              <div key={q.key}>
                <p>
                  <b>{q.label}</b>
                </p>
                <p style={{ whiteSpace: 'pre-wrap' }}>{shownAnswer(q, raw)}</p>
              </div>
            ))}
            <div>
              <p>
                <b>What to do with this document</b>
              </p>
              <ol>
                <li>Check every detail above before you sign.</li>
                <li>Sign and date it in the space below.</li>
                <li>Keep it. It is your sworn declaration and may be used as evidence.</li>
                <li>
                  If a lawyer or a rights organization contacts you, give them this document and
                  your reference, <span className="mono">{r.public_ref}</span>.
                </li>
              </ol>
            </div>
            <p>
              <b>Declaration under 28 U.S.C. § 1746</b>
            </p>
            <p>{DECLARATION[where]}</p>
            <p className="mono" style={{ fontSize: '.8rem' }}>
              Executed on: {BLANK} &nbsp; At: {place.trim() || BLANK}
            </p>
            <p>Signature: {name.trim() || BLANK}</p>
            <p>Date: {BLANK}</p>
            <p className="muted" style={{ fontSize: '.85rem' }}>
              This declaration is of one sealed version of this report, chained to every report
              filed before it in the same logbook. Anyone can check it at /verify/{r.public_ref}.
              Printed {new Date().toISOString().slice(0, 10)}.
            </p>
            <p className="mono" style={{ fontSize: '.8rem', overflowWrap: 'anywhere' }}>
              Fingerprint: {r.content_hash}
              <br />
              Chain hash: {r.chain_hash}
            </p>
          </section>
        </div>
      </div>
    </StaffPage>
  );
}
