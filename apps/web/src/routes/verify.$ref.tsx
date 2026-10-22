import { verifyReport } from '@reportlog/contracts';
import type { Verification } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { CheckRow } from '../components/CheckRow.tsx';
import { ApiRequestError, call } from '../lib/api.ts';
import { recheckInBrowser, recheckPassed } from '../lib/recheck.ts';

export const verificationQuery = (ref: string) =>
  queryOptions({
    queryKey: ['verify', ref],
    queryFn: ({ signal }) => call(verifyReport, { params: { ref }, signal }),
  });

export const Route = createFileRoute('/verify/$ref')({
  component: VerifyPage,
});

function VerifyPage() {
  const { ref } = Route.useParams();
  const query = useQuery(verificationQuery(ref));

  return (
    <section className="space-y-6">
      <h1 className="font-display text-title font-bold">
        Report <span className="font-mono">{ref}</span>
      </h1>
      {query.isPending && <p role="status">Checking…</p>}
      {query.isError && <VerifyError error={query.error} />}
      {query.isSuccess && <VerifyResult v={query.data} />}
    </section>
  );
}

function VerifyError({ error }: { error: Error }) {
  const missing = error instanceof ApiRequestError && error.status === 404;
  return (
    <div role="alert" className="space-y-2">
      <p className="font-semibold">
        {missing ? 'There is no report with that reference.' : error.message}
      </p>
      <Link to="/" className="underline">
        Check another reference
      </Link>
    </div>
  );
}

export function VerifyResult({ v }: { v: Verification }) {
  const browser = recheckInBrowser(v);
  return (
    <div className="space-y-8">
      <p className="text-ink-alt">
        In the logbook <strong>{v.chain.logbook_title}</strong>, received{' '}
        <time dateTime={v.received_at}>{new Date(v.received_at).toUTCString()}</time>.
      </p>

      <ul className="space-y-3" aria-label="Checks">
        <CheckRow
          ok={v.content.ok}
          title="The report has not been edited"
          detail="Its answers, its logbook and its publication answer still produce the fingerprint recorded when it was filed. Change any character and this stops matching."
        />
        <CheckRow
          ok={v.link.ok}
          title="Its place in the chain is intact"
          detail="Each report's fingerprint is combined with the one before it in the same logbook. That combination still comes out right."
        />
        <CheckRow
          ok={v.position.ok}
          title="Nothing has been inserted or removed around it"
          detail="The report this one follows is still the report it was filed after, in the same logbook."
        />
        <CheckRow
          ok={recheckPassed(browser)}
          title="Checked again in your browser"
          detail={
            browser.kind === 'text'
              ? "This page recomputed the fingerprint itself from the bytes shown below, without relying on the server's own answer."
              : "This page recombined the report's fingerprint with the one before it and got the recorded link, without relying on the server's own answer."
          }
        />
      </ul>

      <p>
        {v.anchor.anchored
          ? `An outside timestamp from ${v.anchor.date} covers this report.`
          : 'No outside timestamp covers this report yet. The chain is timestamped once a day, so a report filed today is not covered until tomorrow.'}
      </p>

      {v.canonical_json === undefined ? (
        <div className="space-y-2 rounded-card border border-line bg-surface p-4 text-sm">
          <p className="font-semibold">What this report says is not shown</p>
          <p>
            It has not been published, so only its fingerprints are shown here. They are enough to
            show the record has not changed since it was filed. Its text appears on this page once a
            moderator publishes it.
          </p>
          <dl className="space-y-1 font-mono text-xs break-all">
            <dt className="font-sans font-semibold">Fingerprint</dt>
            <dd>{v.content.recorded}</dd>
            <dt className="font-sans font-semibold">Link in the chain</dt>
            <dd>{v.link.recorded}</dd>
            <dt className="font-sans font-semibold">The link before it</dt>
            <dd>{v.link.prev_chain_hash}</dd>
          </dl>
        </div>
      ) : (
        <details className="rounded-card border border-line bg-surface p-4">
          <summary className="cursor-pointer font-semibold">Check it yourself</summary>
          <div className="mt-3 space-y-3 text-sm">
            <p>
              These are the exact bytes that were fingerprinted (RFC 8785 canonical JSON). Their
              SHA-256 should be <span className="font-mono break-all">{v.content.recorded}</span>.
            </p>
            <pre className="overflow-x-auto rounded-card bg-paper-alt p-3 font-mono text-xs">
              {v.canonical_json}
            </pre>
          </div>
        </details>
      )}
    </div>
  );
}
