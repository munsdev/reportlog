/**
 * The hand-written pages: the homepage, the docs index and "Using it".
 *
 * Every claim here is one the software enforces, and most are said in the
 * same words by the About page every deployment carries
 * (`apps/web/src/routes/about.tsx`) or by its guides
 * (`apps/web/src/features/site-pages/Guides.tsx`). When one of those
 * changes, change this too. The install guide and the release notes are not
 * written here at all: they are built from `deploy/README.md` and
 * `CHANGELOG.md`, so they cannot drift from what ships.
 */
import { SOURCE } from './layout.ts';

export const HOME = `
<section class="hero">
<p class="eyebrow">Free software for incident reports</p>
<h1>A record of what people report, that nobody can quietly change.</h1>
<p class="lede">ReportLog takes in reports through questionnaires you build, puts every one in front of a moderator before anything is published, and seals each report into a chain so that any later change shows. Anybody can check a published report in their own browser, without trusting the server that holds it.</p>
<p class="actions"><a class="button" href="/docs/install/">Install it on a server</a> <a class="button quiet" href="/docs/using/">See how it works</a></p>
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
<p>There is no automatic publishing and there never will be. A moderator reads every report first. Who filed it is kept apart and encrypted, and opening it takes a reason that the reporter can see.</p>
</div>
</section>

<section class="split">
<div>
<h2>Built for people who will be asked “how do we know?”</h2>
<p>Election observers, newsrooms collecting tips, safety teams, ombuds offices: anybody whose reports may be disputed later, and who wants to answer with something better than “trust us”.</p>
<p>You build a <strong>logbook</strong> for each subject, a questionnaire with the questions that matter to you. When nothing needs to be permanent, a <strong>list</strong> collects the same kinds of answer without sealing them, for tallies, links and contact forms.</p>
</div>
<div>
<h2>Yours to run, nobody else’s to watch</h2>
<ul class="ticks">
<li>Runs on one server you control: PostgreSQL, the application and Caddy, set up by one installer.</li>
<li>The pages load no fonts, scripts, maps or trackers from anywhere else, so reading your archive tells no third party that somebody did.</li>
<li>The rules are enforced in the database, below the application: the tables that hold reports refuse updates and deletes.</li>
<li>Staff sign in with a one-time code and prove a second factor. One kind of administrator cannot make more of itself.</li>
</ul>
</div>
</section>

<section class="card plain">
<h2>What it deliberately cannot do</h2>
<p><strong>It cannot tell you a report is true.</strong> It can show that a report was filed at a certain time, has not changed since, and was reviewed by a person. <strong>It cannot prove nothing was left out:</strong> a report that was never filed leaves no trace. Saying so plainly is part of the design.</p>
</section>

<section class="cta">
<h2>Read every line of it</h2>
<p>ReportLog is licensed AGPL-3.0-or-later. Every claim on this page can be checked against the source rather than taken on trust, and whoever runs a deployment cannot change what it does for the people using it without publishing that change too.</p>
<p class="actions"><a class="button" href="${SOURCE}">The source code</a> <a class="button quiet" href="/docs/">The documentation</a></p>
</section>
`;

export const DOCS_INDEX = `
<p class="eyebrow">Documentation</p>
<h1>Running ReportLog</h1>
<p class="lede">Everything here is for the people who install and run a ReportLog site. Each deployment also carries its own guides for its staff, at <code>/docs</code> on the site itself.</p>
<ul class="cards">
<li class="card"><h2><a href="/docs/install/">Install and operate</a></h2><p>Setting up a server, the settings, deploying, updates, rolling back, backups and restoring, and what to look at when something is wrong. This is the runbook that ships with the software, published as it is.</p></li>
<li class="card"><h2><a href="/docs/using/">Using it</a></h2><p>The first hour on a new site, logbooks and lists, launching, roles, moderation, and how anybody checks a report.</p></li>
<li class="card"><h2><a href="/docs/releases/">Releases</a></h2><p>What changed in each release, written for the people who use and run a site.</p></li>
</ul>
<h2>The short version</h2>
<p>You need a server running Debian 12 or Ubuntu 24.04, a domain whose DNS you control, an email sending account and EU object storage for backups. Then:</p>
<pre><code class="language-sh">git clone ${SOURCE}.git /root/reportlog
sudo /root/reportlog/deploy/install.sh   # installs everything and asks for your settings
sudo reportlog deploy
sudo reportlog site-password             # the password that lets you, and only you, set it up
sudo reportlog doctor                    # checks everything it can</code></pre>
<p>The <a href="/docs/install/#setting-up-a-server">install guide</a> explains each step, and what to have ready before you start.</p>
`;

export const USING = `
<p class="eyebrow">Documentation</p>
<h1>Using ReportLog</h1>
<p class="lede">What happens after the install: the first hour, the one decision that cannot be undone, who may do what, and how anybody checks the result.</p>
<nav class="toc" aria-label="Contents"><ol>
<li><a href="#first-hour">The first hour</a></li>
<li><a href="#logbook-or-list">A logbook or a list</a></li>
<li><a href="#build">Building a logbook</a></li>
<li><a href="#launch">Launching: the one-way door</a></li>
<li><a href="#roles">Roles</a></li>
<li><a href="#moderation">Moderation and consent</a></li>
<li><a href="#walk">File one for real</a></li>
<li><a href="#checking">Checking a report</a></li>
<li><a href="#keeping">Keeping it running</a></li>
</ol></nav>

<h2 id="first-hour">The first hour</h2>
<p>A fresh site sits behind a site password, set on the server with <code>sudo reportlog site-password</code>. Open the site, enter it, and the setup wizard makes you the <strong>owner</strong> and asks whether to keep the password in front of the site. The wizard refuses to run without one, so a stranger who finds a fresh install cannot seat themselves as its owner.</p>
<p>Staff sign in with a one-time code sent by email, so email has to work first (<code>sudo reportlog mail-test you@example.org</code>). Everybody who holds a role also sets up a second factor; until they have, the site treats them as somebody with no role at all.</p>

<h2 id="logbook-or-list">A logbook or a list</h2>
<p>A site with no logbook accepts no reports, and that is deliberate. A form is the question set; a logbook or a list is what happens to the answers. The choice is one question: <strong>does this need to be permanent and checkable?</strong></p>
<ul>
<li>A <strong>logbook</strong> seals every report, chains it to the one before, never lets anything be changed or deleted afterwards, asks every reporter for an address and their consent, and publishes nothing until a moderator approves it.</li>
<li>A <strong>list</strong> seals nothing. Its form can change, it erases the personal half of what it collects after a while, it is reviewed in batches, and it publishes counts rather than anything a person wrote.</li>
</ul>
<p>A list is not a logbook with the guarantees switched off. A hard rule with a switch in front of it is not a hard rule.</p>

<h2 id="build">Building a logbook</h2>
<p>Under <em>Logbooks</em>, make one. It asks for a title, which reporters see, and a web address, which is sealed into every report and can never be changed. Start from one of the shipped question sets (election incidents, incident reports, safety observations, complaints about a practitioner and others) or from a logbook file downloaded from another site. Either way it arrives as a draft you can change freely.</p>
<p>Add questions one at a time. For each, decide whether an answer is needed, whether it is offered as a filter on the public board, and whether it is asked only after a particular earlier answer. Nothing is a filter unless you say so: when and where are questions you ask, not built-in parts of a report.</p>
<p>Three things people get wrong:</p>
<ul>
<li><strong>Do not ask for contact details, consent, or permission to publish.</strong> Every report is asked those, whatever logbook it came through.</li>
<li><strong>A written account is not built in.</strong> If you want one, ask for it as a long text question.</li>
<li><strong>A follow-up needs fixed answers to follow.</strong> The earlier question has to be yes or no, or a choice.</li>
</ul>

<h2 id="launch">Launching: the one-way door</h2>
<p>A draft cannot be filed to. Launching opens it, puts it on the front page, and <strong>cannot be undone</strong>. Afterwards a logbook may gain a new optional question and have its wording clarified, and nothing else: no removing, no reordering, no making an optional question required. The database itself refuses anything more.</p>
<p>Every report seals the version of the questions its reporter was actually asked, so a changed form would leave reports in one logbook that cannot be read against one definition. Practise on a test site: download the logbook as a file, upload it there, launch it and file as often as you like.</p>
<p>A logbook can be given an opening and a closing time. Closing it stops new reports; everything already filed stays published and checkable.</p>

<h2 id="roles">Roles</h2>
<div class="table"><table>
<thead><tr><th>Role</th><th>Can appoint</th></tr></thead>
<tbody>
<tr><td>Moderator</td><td>Nobody</td></tr>
<tr><td>Access Manager</td><td>Moderators, not other Access Managers</td></tr>
<tr><td>Administrator</td><td>Moderators and Access Managers, not other administrators</td></tr>
<tr><td>Owner</td><td>All of those, and administrators. There is exactly one owner, and the seat is only ever handed over, never granted.</td></tr>
</tbody>
</table></div>
<p>An administrator is not automatically a moderator: somebody who should do both is given both. Appoint people under <em>Access</em> with their email address and a role.</p>

<h2 id="moderation">Moderation and consent</h2>
<p>Nothing is public until a moderator approves it, one report at a time. What a moderator approves is a judgement, and it belongs to whoever runs the site, who publishes their standard on the site’s moderation standard page.</p>
<p>The reporter’s consent is the ceiling and moderation is the floor: a moderator may publish a report’s text and hold back its files, never the reverse, and only the reporter can change what they allowed. Who filed a report is encrypted and kept apart; a moderator opens it only by giving a reason, and the reporter sees that it was opened and why.</p>

<h2 id="walk">File one for real</h2>
<p>With a logbook launched and a moderator appointed, file a report yourself and <strong>follow the confirmation link in the email</strong>. A path that only runs when somebody clicks a link in an email is the path nothing reaches by accident. Then approve it as the moderator and find it on the public board. Do this by hand on every new site.</p>

<h2 id="checking">Checking a report</h2>
<p>Every published report shows its fingerprint. Anybody holding a report’s reference can check it at <code>/verify/</code> followed by the reference, on any ReportLog site that published it. The check runs in the reader’s own browser, with the same code the server sealed the report with, so it does not need the server to be honest.</p>
<p>Once a day the newest report of every logbook is timestamped by an outside authority and published to the transparency log. That is what shows a whole logbook has not been rebuilt or removed.</p>

<h2 id="keeping">Keeping it running</h2>
<ul>
<li><code>sudo reportlog doctor</code> checks the server and says what is wrong in plain words.</li>
<li><code>sudo reportlog updates</code> shows what a new release would change; <code>sudo reportlog deploy vX.Y.Z</code> installs it. There is deliberately no update button on the website.</li>
<li><code>sudo reportlog rollback</code> goes back one release without touching the database.</li>
<li>Backups run every night and go off the server. Keep a copy of the settings file somewhere else: backups deliberately leave out the keys.</li>
</ul>
<p>All of it is in the <a href="/docs/install/">install and operations guide</a>.</p>
`;
