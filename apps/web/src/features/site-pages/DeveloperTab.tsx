/**
 * The "For developers" tab of How to use this: what /api/v1 serves, the two
 * rules about the numbers, the stability promise and the licence. Static
 * text describing getPublicApi and getPublicStats in
 * packages/contracts/src/board.ts; it asks the server for nothing. If a
 * field is added to /api/v1/stats, add its row here.
 */
import { Link } from '@tanstack/react-router';
import { plainSiteName, useSite } from '../../components/ui/site.tsx';
import { CopyBox } from '../../mockup/CopyBox.tsx';

const ENDPOINTS = [
  ['GET /api/v1', 'What this API offers, its licence and its stability promise.'],
  [
    'GET /api/v1/stats',
    'The published counts, already broken out. Cached for 60 seconds; please honour that rather than asking more often.',
  ],
  [
    'GET /api/v1/consent-texts',
    'Every wording of the publication question this site has shown, by digest.',
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

/** The mock-up's key and value list (.kv-list). */
function Fields({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="kv-list" aria-label="The fields">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt style={{ overflowWrap: 'anywhere' }}>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DeveloperTab() {
  const name = plainSiteName(useSite().data);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <>
      <p>
        The figures {name} publishes, as JSON. No key and no sign-up. They are the same counts the
        board is drawn from.
      </p>
      <h2 id="endpoints">Addresses</h2>
      {ENDPOINTS.map(([address, what]) => (
        <CopyBox
          key={address}
          text={`${origin}${address.replace(/^GET /, '')}`}
          what={address}
          code={address}
        >
          {what}
        </CopyBox>
      ))}
      <pre className="mono" style={{ overflowX: 'auto', fontSize: '.85rem' }}>
        <code>curl {origin}/api/v1/stats</code>
      </pre>
      <p>
        While this site is behind a password, so is its API: an address that answers only past the
        password is the honest description of what is public here.
      </p>

      <h2 id="rules">Two rules about the numbers</h2>
      <h3>There is no bare total, on purpose</h3>
      <p>
        Every count arrives already broken out. There is no single figure to quote, because a lone
        number stripped of what it counts is how a record like this gets misused. If you need one
        number for a headline, use a published count together with the words that qualify it.
      </p>
      <h3>What is and is not counted</h3>
      <p>
        These counts are of published reports only. Declined reports are counted separately, by the
        reason they were declined, on the board’s activity page; nothing still under review is
        counted anywhere. A place with too few reports to show safely is named without a number.
        Reports never confirmed by email are counted nowhere: they never entered the record.
      </p>
      <p>
        <strong>Published is not the same as true.</strong> It means a moderator judged an account
        publishable and the person who filed it allowed that. This archive does not publish a
        verdict on whether an account is true. The <Link to="/standards">moderation standard</Link>{' '}
        says what a moderator checks.
      </p>

      <h2 id="fields">What /api/v1/stats contains</h2>
      <Fields rows={FIELDS} />

      <h2 id="stability">Stability</h2>
      <p>
        The shape under <code>/api/v1</code> is a promise. Fields may be added. Existing fields will
        not be renamed, retyped or removed without a new version at <code>/api/v2</code>. Something
        you build today should still work in a year, because there is no way for us to tell you if
        it stopped.
      </p>

      <h2 id="licence">Licence</h2>
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
    </>
  );
}
