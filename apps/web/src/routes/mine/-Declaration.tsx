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
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Field, FieldDescription } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { RadioGroup, RadioOption } from '@/components/ui/radio-group.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { rawFromAnswers, shownAnswer } from '@/features/form/walk.ts';
import { SignInPrompt } from '@/features/identity/SignInPrompt.tsx';
import { useMe } from '@/features/identity/session.ts';
import { call } from '@/lib/api.ts';

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
      <Page title="Not one of your reports" width="prose">
        <p>{report.error.message}</p>
        <Link to="/mine" className="underline">
          Back to your reports
        </Link>
      </Page>
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
      <p>
        <Link to="/mine/$threadId" params={{ threadId }} className="underline">
          ← Back to the report
        </Link>
      </p>
      <Card variant="quiet">
        <p>Nothing you type here is sent anywhere.</p>
      </Card>
      {r.versions > 1 ? (
        <Alert tone="note" title="This is the newest version">
          It declares what the report says now, after {String(r.versions - 1)}{' '}
          {r.versions === 2 ? 'correction' : 'corrections'}.
        </Alert>
      ) : null}
      <Field>
        <Label>Your full name</Label>
        <FieldDescription>
          Printed under the signature line. Leave it empty to write it by hand.
        </FieldDescription>
        <Input
          value={name}
          autoComplete="name"
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <Field>
        <Label>Where you will sign it</Label>
        <FieldDescription>A city and country. Leave it empty to write it by hand.</FieldDescription>
        <Input
          value={place}
          onChange={(e) => {
            setPlace(e.target.value);
          }}
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend id="signing-where" className="label-face text-xs text-ink">
          Will you sign it in the United States?
        </legend>
        <RadioGroup
          value={where}
          onValueChange={(v) => {
            setWhere(v === 'out' ? 'out' : 'in');
          }}
          aria-labelledby="signing-where"
        >
          <RadioOption value="in" label="In the United States" />
          <RadioOption value="out" label="Outside the United States" />
        </RadioGroup>
      </fieldset>
      <div>
        <Button
          type="button"
          onClick={() => {
            window.print();
          }}
        >
          Print it or save it as a PDF
        </Button>
      </div>

      {/* The document as it will print: a surface with an edge and no shadow. */}
      <section
        id="declaration"
        data-print-only
        aria-labelledby="declaration-title"
        className="flex flex-col gap-4 rounded-card border border-ink-alt bg-surface p-6 font-sans text-ink print:w-full print:rounded-none print:border-0 print:p-0 print:text-[11pt]"
      >
        <h2 id="declaration-title" className="sr-only">
          The declaration
        </h2>
        <p className="font-display text-xl font-bold">{site}: witness statement</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          <dt className="font-semibold">Reference</dt>
          <dd className="font-mono">{r.public_ref}</dd>
          <dt className="font-semibold">Logbook</dt>
          <dd>{r.logbook_title}</dd>
          <dt className="font-semibold">Filed</dt>
          <dd>{new Date(r.first_received_at).toLocaleString()}</dd>
          {r.versions > 1 ? (
            <>
              <dt className="font-semibold">This version</dt>
              <dd>{new Date(r.received_at).toLocaleString()}</dd>
            </>
          ) : null}
        </dl>
        {/* The report is its answers, each under the question the reporter read, in the logbook's order. */}
        <div className="flex flex-col gap-3">
          {answered.map((q) => (
            <div key={q.key}>
              <p className="font-semibold">{q.label}</p>
              <p className="whitespace-pre-wrap">{shownAnswer(q, raw)}</p>
            </div>
          ))}
        </div>
        <div>
          <p className="font-semibold">What to do with this document</p>
          <ol className="list-decimal pl-5">
            <li>Check every detail above before you sign.</li>
            <li>Sign and date it in the space below.</li>
            <li>Keep it. It is your sworn declaration and may be used as evidence.</li>
            <li>
              If a lawyer or a rights organization contacts you, give them this document and your
              reference, <span className="font-mono">{r.public_ref}</span>.
            </li>
          </ol>
        </div>
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="font-semibold">Declaration under 28 U.S.C. § 1746</p>
          <p>{DECLARATION[where]}</p>
          <p>
            Executed on: {BLANK} &nbsp; At: {place.trim() || BLANK}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 pt-10">
          <p className="border-t border-ink pt-1">Signature: {name.trim() || BLANK}</p>
          <p className="border-t border-ink pt-1">Date</p>
        </div>
        <p className="border-t border-line pt-4 text-sm text-ink-alt">
          This declaration is of one sealed version of this report, chained to every report filed
          before it in the same logbook. Anyone can check it at /verify/{r.public_ref}. Printed{' '}
          {new Date().toISOString().slice(0, 10)}.
          <br />
          Fingerprint: <span className="font-mono break-all">{r.content_hash}</span>
          <br />
          Chain hash: <span className="font-mono break-all">{r.chain_hash}</span>
        </p>
      </section>
    </StaffPage>
  );
}
