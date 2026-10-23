/**
 * The homepage. Every claim here is one the software enforces, checked
 * against the code on 23 October 2026; most are said in the same words by
 * the About page every deployment carries (`apps/web/src/routes/about.tsx`).
 * When one of those changes, change this too.
 */
import { SOURCE } from './layout.ts';

export const HOME = `
<section class="hero">
<p class="eyebrow">Free software for incident reports</p>
<h1>A record of what people report, that nobody can quietly change.</h1>
<p class="lede">ReportLog takes in reports through questionnaires you build, puts every one in front of a moderator before anything is published, and seals each report into a chain so that any later change shows. Anybody can check a published report's fingerprint in their own browser, and a daily timestamp from an outside authority shows the record has not been rebuilt since.</p>
<p class="actions"><a class="button" href="/docs/quick-start/">Install it on a server</a> <a class="button quiet" href="/docs/how-it-works/">See how it works</a></p>
</section>

<section class="grid three" aria-label="The three guarantees">
<div class="card">
<p class="eyebrow">Sealed</p>
<h2>Never edited, never deleted</h2>
<p>Every report is written out in one canonical form and fingerprinted with SHA-256, and carries the fingerprint of the report before it. Change one word of an old report and every link after it breaks. A correction is filed as a new version beside the original, and both are kept.</p>
</div>
<div class="card">
<p class="eyebrow">Witnessed</p>
<h2>Somebody else holds the receipt</h2>
<p>Once a day the newest link of every logbook is timestamped by an independent authority and published to a transparency log other people can copy. A logbook on that list stays on it and its count only grows, so not even a whole logbook can disappear unnoticed.</p>
</div>
<div class="card">
<p class="eyebrow">Moderated</p>
<h2>Nothing public until a person says so</h2>
<p>There is no automatic publishing and there never will be. A moderator reads every report first. Who filed it is kept apart and encrypted; opening it takes a written reason, and the reporter can see when it was opened and why.</p>
</div>
</section>

<section class="split">
<div>
<h2>Built for people who will be asked “how do we know?”</h2>
<p>Election observers, newsrooms collecting tips, safety teams, ombuds offices: anybody whose reports may be disputed later, and who wants to answer with something better than “trust us”.</p>
<p>You build a <strong>logbook</strong> for each subject, a questionnaire with the questions that matter to you. When nothing needs to be permanent, a <strong>list</strong> collects the same kinds of answer without sealing them, for tips, check-ins and contact forms.</p>
</div>
<div>
<h2>Yours to run, nobody else’s to watch</h2>
<ul class="ticks">
<li>Runs on one server you control: PostgreSQL, the application and Caddy, set up by one installer.</li>
<li>The pages load no fonts, scripts, maps or trackers from anywhere else, so reading your archive tells no third party that somebody did.</li>
<li>The rules are enforced in the database, below the application: the tables that hold reports refuse updates and deletes.</li>
<li>Staff sign in with a one-time code and prove a second factor. Neither kind of administrator can appoint its own kind.</li>
</ul>
</div>
</section>

<section class="card plain">
<h2>What it deliberately cannot do</h2>
<p><strong>It cannot tell you a report is true.</strong> It can show that a report was filed at a certain time, has not changed since, and was reviewed by a person. <strong>It cannot prove nothing was left out:</strong> a report that was never filed leaves no trace. Saying so plainly is part of the design.</p>
</section>

<section class="cta">
<h2>Read every line of it</h2>
<p>ReportLog is licensed under the GNU Affero General Public License. Every claim on this page can be checked against the source rather than taken on trust, and whoever runs a deployment and changes it must offer the changed source to the people using it.</p>
<p class="actions"><a class="button" href="${SOURCE}">The source code</a> <a class="button quiet" href="/docs/">The documentation</a></p>
</section>
`;
