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
import { CheckRow } from '../components/CheckRow.tsx';
import { Alert } from '../components/ui/alert.tsx';
import { BandPage } from '../components/ui/band.tsx';
import { Tick } from '../components/ui/choice.tsx';
import { KeyValueList } from '../components/ui/key-value-list.tsx';
import { CheckAReport } from '../features/board/CheckAReport.tsx';
import { CopyButton } from '../features/site-pages/CopyButton.tsx';
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
    <BandPage
      title={`Check ${ref}`}
      heading="Has it changed?"
      eyebrow="Check a report"
      lede="Enter a reference. This page fetches the report’s sealed record and recomputes its fingerprint in your browser, then compares it with the chain."
    >
      <div className="flex max-w-[640px] flex-col gap-6">
        {/* key: a new reference starts a new field. */}
        <CheckAReport
          key={ref}
          inline
          initial={ref}
          button="Check"
          help="Looks like RL-XXXX-XX. It is on the report page and in your email."
        />
        {query.isPending ? <p role="status">Checking…</p> : null}
        {query.isError ? <VerifyError error={query.error} /> : null}
        {query.isSuccess ? <VerifyResult v={query.data} ref_={ref} /> : null}
        <p className="text-muted">
          If a check fails, the page says which step failed and shows both values. A failed check on
          one report means that report; it says nothing about the others.
        </p>
      </div>
    </BandPage>
  );
}

function VerifyError({ error }: { error: Error }) {
  const missing = error instanceof ApiRequestError && error.status === 404;
  return (
    <Alert tone="serious" title={missing ? 'There is no report with that reference.' : undefined}>
      {missing ? 'Check that the whole reference was copied.' : error.message}
    </Alert>
  );
}

/**
 * The verdict: words first, a mark second, colour last (mock-up .result).
 * Which check failed is named, so "does not check out" is never the whole story.
 */
function Verdict({ failed, ref_ }: { failed: string[]; ref_: string }) {
  const ok = failed.length === 0;
  return (
    <div
      role="status"
      className={`grid gap-1.5 rounded-card border-(length:--rl-border-main) bg-surface p-5 ${
        ok ? 'border-confirmed' : 'border-serious'
      }`}
    >
      <span
        className={`label-face inline-flex items-center gap-2 text-xs ${
          ok ? 'text-confirmed' : 'text-serious'
        }`}
      >
        <span aria-hidden="true">{ok ? <Tick /> : '✕'}</span>
        {ok ? 'Checked just now' : 'Does not check out'}
      </span>
      <h2 className="font-display text-[clamp(1.4rem,3.6vw,2rem)] leading-[1.05]">
        {ok ? 'This report has not been changed.' : 'This report does not check out.'}
      </h2>
      <p className="font-mono text-sm text-muted">{ref_}</p>
      {ok ? null : <p className="text-ink-alt">What failed: {failed.join('; ')}.</p>}
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
  const fingerprints = [
    {
      key: 'Fingerprint',
      value: <Hash value={v.content.recorded} what="the fingerprint" />,
      mono: true,
    },
    {
      key: 'Link in the chain',
      value: <Hash value={v.link.recorded} what="the link in the chain" />,
      mono: true,
    },
    {
      key: 'The link before it',
      value: <Hash value={v.link.prev_chain_hash} what="the link before it" />,
      mono: true,
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <Verdict failed={checks.filter((c) => !c.ok).map((c) => c.title.toLowerCase())} ref_={ref_} />
      <ul className="grid list-none gap-2.5 p-0" aria-label="Checks">
        {checks.map((c) => (
          <CheckRow key={c.title} ok={c.ok} title={c.title} detail={c.detail} />
        ))}
      </ul>
      {/* The verdict above is the answer. The rest is for somebody who wants
          to see how it was reached, so it is folded away, not removed. */}
      <details className="rounded-card border-[1.5px] border-line bg-surface p-4">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
          Technical details
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <KeyValueList items={fingerprints} />
          {v.canonical_json === undefined ? null : (
            <div className="flex flex-col gap-3 text-sm">
              <p className="max-w-prose">
                These are the exact bytes that were fingerprinted (RFC 8785 canonical JSON). Their
                SHA-256 should be <span className="font-mono break-all">{v.content.recorded}</span>.
              </p>
              <pre className="overflow-x-auto rounded-card bg-paper-alt p-3 font-mono text-xs">
                {v.canonical_json}
              </pre>
              <p className="max-w-prose">
                Its link in the chain is the SHA-256 of its fingerprint followed by the link before
                it, both as text. The first report in this logbook follows the logbook&apos;s
                starting point, <span className="font-mono break-all">{v.chain.genesis}</span>,
                which is the SHA-256 of <span className="font-mono">reportlog-chain:</span> and the
                logbook&apos;s address.
              </p>
              <p className="max-w-prose">
                In a shell, save the bytes above as report.json with no line break at the end, then:
              </p>
              <pre className="overflow-x-auto rounded-card bg-paper-alt p-3 font-mono text-xs">
                {[
                  'sha256sum report.json',
                  `printf %s ${v.content.recorded}${v.link.prev_chain_hash} | sha256sum`,
                  `printf %s reportlog-chain:${v.chain.logbook} | sha256sum`,
                ].join('\n')}
              </pre>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

/** A hash that wraps rather than running off a phone, with a way to copy it. */
function Hash({ value, what }: { value: string; what: string }) {
  return (
    <span className="flex flex-col items-start">
      <span className="break-all">{value}</span>
      <CopyButton text={value} what={what} />
    </span>
  );
}
