/**
 * The public API page (legacy `api.html`): what /api/v1 serves, the two
 * rules about the numbers, the stability promise and the licence.
 *
 * At /public-api, not /api: every address under /api is the server's.
 *
 * Static text describing the contracts in packages/contracts/src/board.ts
 * (getPublicApi, getPublicStats). It asks the server for nothing, so it
 * reads the same whether or not the archive is public. If a field is added
 * to /api/v1/stats, add its row here.
 *
 * NOT PORTED: legacy's paste-in widget. It carried colours of its own,
 * written into somebody else's page, and described fields (veracity,
 * severity, states, corroboration) this archive does not publish.
 */
import { Link, createFileRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { PublicPage } from '../features/site-pages/PublicPage.tsx';
import { ProseSection } from '../components/ui/prose-section.tsx';
import { plainSiteName, useSite } from '../components/ui/site.tsx';
import { CopyButton } from '../features/site-pages/CopyButton.tsx';
import { ScrollX } from '@/components/ui/scroll-x.tsx';

export const Route = createFileRoute('/public-api')({
  component: PublicApiPage,
});

const ENDPOINTS = [
  ['GET /api/v1', 'What this API offers, its licence and its stability promise.'],
  [
    'GET /api/v1/stats',
    'The published counts, already broken out. Cached for 60 seconds; please honour that rather than asking more often.',
  ],
  [
    'GET /api/v1/consent-texts',
    'Every wording of the publication question this site has shown, by digest. A published report seals the digest of the exact sentence its reporter answered; this is how that digest is read back and checked.',
  ],
] as const;

const FIELDS = [
  [
    'published',
    'False when this archive does not publish, with a reason in words. Nothing else is sent then.',
  ],
  ['as_of', 'When these figures were computed (ISO 8601, UTC).'],
  ['note', 'What the figures count, in a sentence.'],
  [
    'not_a_sample',
    'A sentence to print beside every one of these numbers: they are reports people chose to file, not a sample, and cannot be read as a rate.',
  ],
  [
    'published_reports.by_logbook',
    'For each logbook: its title, how many of its reports are published, and for each question an operator chose to count, how many published reports gave each answer, and how many left it unanswered. A report that ticked several choices counts under each, so these can add up to more than the reports. Places with fewer reports than a map’s threshold are listed under withheld, without their counts.',
  ],
  ['api_version', 'Always 1 here.'],
  ['licence', 'The terms these figures are offered on.'],
] as const;

function Table({
  head,
  rows,
}: {
  head: [string, string];
  rows: readonly (readonly [string, ReactNode])[];
}) {
  return (
    <ScrollX label="The calls">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="py-2 pr-4 font-semibold">
              {head[0]}
            </th>
            <th scope="col" className="py-2 font-semibold">
              {head[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-line align-top">
              <td className="py-2 pr-4 font-mono whitespace-nowrap">{k}</td>
              <td className="py-2">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}

function PublicApiPage() {
  const name = plainSiteName(useSite().data);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <PublicPage
      title="Public API"
      width="prose"
      lede={`The figures ${name} publishes, as JSON. No key and no sign-up. They are the same counts the board is drawn from.`}
    >
      <ProseSection id="endpoints" title="Addresses">
        <ul className="flex flex-col gap-3" aria-label="Addresses">
          {ENDPOINTS.map(([address, what]) => (
            <li key={address} className="flex flex-col gap-1 rounded-card bg-paper-alt p-4">
              <code className="font-mono text-sm break-all">{address}</code>
              <span className="text-ink-alt">{what}</span>
              <CopyButton text={`${origin}${address.replace(/^GET /, '')}`} what={address} />
            </li>
          ))}
        </ul>
        <pre className="overflow-x-auto rounded-card bg-paper-alt p-3 font-mono text-sm">
          <code>curl {origin}/api/v1/stats</code>
        </pre>
        <p>
          While this site is behind a password, so is its API: an address that answers only past the
          password is the honest description of what is public here.
        </p>
      </ProseSection>

      <ProseSection id="rules" title="Two rules about the numbers">
        <h3 className="font-semibold">There is no bare total, on purpose</h3>
        <p>
          Every count arrives already broken out. There is no single figure to quote, because a lone
          number stripped of what it counts is how a record like this gets misused. If you need one
          number for a headline, use a published count together with the words that qualify it.
        </p>
        <h3 className="font-semibold">What is and is not counted</h3>
        <p>
          These counts are of published reports only. Declined reports are counted separately, by
          the reason they were declined, on the board’s activity page; nothing still under review is
          counted anywhere. A place with too few reports to show safely is named without a number.
          Reports never confirmed by email are counted nowhere: they never entered the record.
        </p>
        <p>
          <strong>Published is not the same as true.</strong> It means a moderator judged an account
          publishable and the person who filed it allowed that. This archive does not publish a
          verdict on whether an account is true. The{' '}
          <Link to="/standards" className="underline underline-offset-2">
            moderation standard
          </Link>{' '}
          says what a moderator checks.
        </p>
      </ProseSection>

      <ProseSection id="fields" title="What /api/v1/stats contains">
        <Table head={['Field', 'Meaning']} rows={FIELDS} />
      </ProseSection>

      <ProseSection id="stability" title="Stability">
        <p>
          The shape under <code className="font-mono">/api/v1</code> is a promise. Fields may be
          added. Existing fields will not be renamed, retyped or removed without a new version at{' '}
          <code className="font-mono">/api/v2</code>. Something you build today should still work in
          a year, because there is no way for us to tell you if it stopped.
        </p>
      </ProseSection>

      <ProseSection id="licence" title="Licence">
        <p>
          The <strong>figures</strong> are offered under <strong>CC BY 4.0</strong>, attributed to
          this site. If you publish one, saying when you fetched it costs nothing and saves an
          argument later.
        </p>
        <p>
          <strong>The reports themselves are not covered.</strong> Each is its author’s own account,
          published here because they allowed that. Their permission is not ours to pass on, so
          nothing here licenses you to republish what a report says.
        </p>
      </ProseSection>
    </PublicPage>
  );
}
