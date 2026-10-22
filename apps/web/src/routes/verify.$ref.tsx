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
import { useEffect } from 'react';
import { CheckRow } from '../components/CheckRow.tsx';
import { Alert } from '../components/ui/alert.tsx';
import { Card } from '../components/ui/card.tsx';
import { Tick } from '../components/ui/choice.tsx';
import { KeyValueList } from '../components/ui/key-value-list.tsx';
import { plainSiteName, useSite } from '../components/ui/site.tsx';
import { Eyebrow } from '../components/ui/type.tsx';
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
  const site = plainSiteName(useSite().data);
  useEffect(() => {
    document.title = `Check ${ref} · ${site}`;
  }, [ref, site]);

  return (
    <article className="flex max-w-prose flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Eyebrow>Check a report</Eyebrow>
        <h1 className="font-mono text-[clamp(1.5rem,1.2rem+1.5vw,2.25rem)] leading-tight font-medium tracking-normal break-all normal-case">
          {ref}
        </h1>
      </div>
      {query.isPending ? <p role="status">Checking…</p> : null}
      {query.isError ? <VerifyError error={query.error} /> : null}
      {query.isSuccess ? <VerifyResult v={query.data} /> : null}
      <Card variant="quiet" heading={query.isError ? 'Try another reference' : 'Check another'}>
        <CheckAReport button="Check it" help={null} />
      </Card>
    </article>
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
 * The verdict: words first, a mark second, colour last. Which check failed
 * is named, so "does not check out" is never the whole story.
 */
function Verdict({ failed }: { failed: string[] }) {
  const ok = failed.length === 0;
  return (
    <Card variant="deep" className="flex-row items-start gap-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-on-deep text-deep"
      >
        {ok ? <Tick /> : <span className="font-bold">✕</span>}
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-display text-xl">
          {ok ? 'This report has not been changed.' : 'This report does not check out.'}
        </p>
        {ok ? null : <p className="text-on-deep-muted">What failed: {failed.join('; ')}.</p>}
      </div>
    </Card>
  );
}

export function VerifyResult({ v }: { v: Verification }) {
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
      <Verdict failed={checks.filter((c) => !c.ok).map((c) => c.title.toLowerCase())} />
      <p className="text-ink-alt">
        In the logbook <strong className="text-ink">{v.chain.logbook_title}</strong>, received{' '}
        <time dateTime={v.received_at} className="font-mono text-sm">
          {new Date(v.received_at).toUTCString()}
        </time>
        .
      </p>

      <ul className="flex flex-col gap-3" aria-label="Checks">
        {checks.map((c) => (
          <CheckRow key={c.title} ok={c.ok} title={c.title} detail={c.detail} />
        ))}
      </ul>

      <p className="max-w-prose">
        {v.anchor.anchored
          ? `An outside timestamp from ${v.anchor.date} covers this report.`
          : 'No outside timestamp covers this report yet. The chain is timestamped once a day, so a report filed today is not covered until tomorrow.'}
      </p>

      {v.canonical_json === undefined ? (
        <Card heading="What this report says is not shown">
          <p className="max-w-prose">
            It has not been published, so only its fingerprints are shown here. They are enough to
            show the record has not changed since it was filed. Its text appears on this page once a
            moderator publishes it.
          </p>
          <KeyValueList items={fingerprints} />
        </Card>
      ) : (
        <>
          <Card heading="Its fingerprints">
            <KeyValueList items={fingerprints} />
          </Card>
          <details className="rounded-card border border-ink-alt bg-surface p-4">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
              Check it yourself
            </summary>
            <div className="mt-3 flex flex-col gap-3 text-sm">
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
          </details>
        </>
      )}
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
