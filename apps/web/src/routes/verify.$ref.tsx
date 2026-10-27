/**
 * Checking a report (public.md §06): does it still match its fingerprint?
 *
 * The verdict comes first, in words, then the four checks, the outside
 * timestamp, and the fingerprints. A report that is not public shows its
 * fingerprints and nothing it says. The page ends with the reference field
 * again, so a second check does not go back to the front page.
 */
import { verifyReport } from '@reportlog/contracts';
import type { Verification } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ApiRequestError, call } from '../lib/api.ts';
import { recheckInBrowser, recheckPassed } from '../lib/recheck.ts';
import { Band, MockPage } from '../mockup/Band.tsx';
import { CopyButton } from '../mockup/CopyButton.tsx';
import { RefForm } from '../mockup/RefForm.tsx';
import { useBodyClass } from '../mockup/useBodyClass.ts';

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
  useBodyClass('light');
  return (
    <MockPage>
      <Band
        eyebrow="Check a report"
        title="Has it changed?"
        tabTitle={`Check ${ref}`}
        lead="Enter a reference. This page fetches the report’s sealed record and recomputes its fingerprint in your browser, then compares it with the chain."
      />
      <div className="wrap" style={{ paddingTop: 28, display: 'grid', gap: 26, maxWidth: 720 }}>
        {/* key: a new reference starts a new field. */}
        <RefForm key={ref} initial={ref} />
        {query.isPending ? <p role="status">Checking…</p> : null}
        {query.isError ? <VerifyError error={query.error} /> : null}
        {query.isSuccess ? <VerifyResult v={query.data} ref_={ref} /> : null}
        <p className="muted" style={{ fontSize: '.9rem' }}>
          If a check fails, the page says which step failed and shows both values. A failed check on
          one report means that report; it says nothing about the others.
        </p>
      </div>
    </MockPage>
  );
}

function VerifyError({ error }: { error: Error }) {
  const missing = error instanceof ApiRequestError && error.status === 404;
  return (
    <div className="result" role="alert" style={{ borderColor: 'var(--rl-serious)' }}>
      <h2>{missing ? 'There is no report with that reference.' : 'The check could not be run.'}</h2>
      <p className="muted">
        {missing ? 'Check that the whole reference was copied.' : error.message}
      </p>
    </div>
  );
}

const TICK = (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2 6.3l2.5 2.4L10 3.2" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

/**
 * The verdict: words first, a mark second, colour last (mock-up .result).
 * Which check failed is named, so "does not check out" is never the whole story.
 */
function Verdict({ failed, ref_ }: { failed: string[]; ref_: string }) {
  const ok = failed.length === 0;
  return (
    <div
      className="result"
      role="status"
      style={ok ? undefined : { borderColor: 'var(--rl-serious)' }}
    >
      <span className="st" style={ok ? undefined : { color: 'var(--rl-serious)' }}>
        {ok ? (
          <svg viewBox="0 0 12 12" width="14" height="14" aria-hidden="true">
            <path d="M2 6.3l2.5 2.4L10 3.2" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        ) : (
          <span aria-hidden="true">✕</span>
        )}
        {ok ? 'Checked just now' : 'Does not check out'}
      </span>
      <h2>{ok ? 'This report has not been changed' : 'This report does not check out'}</h2>
      <p className="muted">{ref_}</p>
      {ok ? null : <p>What failed: {failed.join('; ')}.</p>}
    </div>
  );
}

export function VerifyResult({ v, ref_ = '' }: { v: Verification; ref_?: string }) {
  const browser = recheckInBrowser(v);
  const checks = [
    {
      ok: v.content.ok,
      title: 'The report has not been edited',
      detail:
        'Its answers, its logbook and its publication answer still produce the fingerprint recorded when it was filed. Change any character and this stops matching.',
    },
    {
      ok: v.link.ok,
      title: 'Its place in the chain is intact',
      detail:
        "Each report's fingerprint is combined with the one before it in the same logbook. That combination still comes out right.",
    },
    {
      ok: v.position.ok,
      title: 'Nothing has been inserted or removed around it',
      detail:
        'The report this one follows is still the report it was filed after, in the same logbook.',
    },
    {
      ok: recheckPassed(browser),
      title: 'Checked again in your browser',
      detail:
        browser.kind === 'text'
          ? "This page recomputed the fingerprint itself from the bytes shown below, without relying on the server's own answer."
          : "This page recombined the report's fingerprint with the one before it and got the recorded link, without relying on the server's own answer.",
    },
  ];
  return (
    <>
      <Verdict failed={checks.filter((c) => !c.ok).map((c) => c.title.toLowerCase())} ref_={ref_} />
      <ul className="checks" aria-label="What was checked">
        {checks.map((c) => (
          <li key={c.title}>
            <span
              className="tick"
              aria-hidden="true"
              style={c.ok ? undefined : { background: 'var(--rl-serious)' }}
            >
              {c.ok ? TICK : '✕'}
            </span>
            <span>
              <b>
                <span className="sr-only">{c.ok ? 'Holds: ' : 'Fails: '}</span>
                {c.title}.
              </b>
              <br />
              <span className="muted">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {/* The verdict above is the answer. The rest is for somebody who wants
          to see how it was reached, so it is folded away, not removed. */}
      <details className="tech">
        <summary>Technical details</summary>
        <div className="in">
          <span>Fingerprint</span>
          <Hash value={v.content.recorded} what="the fingerprint" />
          <span>Link in the chain</span>
          <Hash value={v.link.recorded} what="the link in the chain" />
          <span>The link before it</span>
          <Hash value={v.link.prev_chain_hash} what="the link before it" />
          {v.canonical_json === undefined ? null : (
            <>
              <span>
                These are the exact bytes that were fingerprinted (RFC 8785 canonical JSON). Their
                SHA-256 should be {v.content.recorded}.
              </span>
              <pre style={{ overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{v.canonical_json}</pre>
              <span>
                Its link in the chain is the SHA-256 of its fingerprint followed by the link before
                it, both as text. The first report in this logbook follows the logbook&apos;s
                starting point, {v.chain.genesis}, which is the SHA-256 of reportlog-chain: and the
                logbook&apos;s address.
              </span>
              <span>
                In a shell, save the bytes above as report.json with no line break at the end, then:
              </span>
              <pre style={{ overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                {[
                  'sha256sum report.json',
                  `printf %s ${v.content.recorded}${v.link.prev_chain_hash} | sha256sum`,
                  `printf %s reportlog-chain:${v.chain.logbook} | sha256sum`,
                ].join('\n')}
              </pre>
            </>
          )}
        </div>
      </details>
    </>
  );
}

/** A hash that wraps rather than running off a phone, with a way to copy it. */
function Hash({ value, what }: { value: string; what: string }) {
  return (
    <span>
      {value} <CopyButton text={value} what={what} />
    </span>
  );
}
