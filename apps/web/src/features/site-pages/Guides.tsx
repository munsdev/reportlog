/**
 * The guides: plain pages in the site's own look, ported from the parts of
 * the old application's docs.html that still describe this software.
 *
 * NOT PORTED: the install guide itself (the server, DNS, mail, storage, the
 * commands). It described the old application's install, and the new one is
 * the operations workstream's (`deploy/README.md` on its branch). Copying the
 * old commands here would hand an operator commands that no longer work.
 * Nor the old page's script (copy buttons, the fill-in-once panel), which
 * only served those commands.
 *
 * Static text, no requests: a guide reads the same whatever the server says.
 */
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { StaffPage } from '../nav/StaffPage.tsx';
import { plainSiteName, useSite } from '../../components/ui/site.tsx';

/** One section of a guide: the mock-up's prose heading, with an anchor for the contents. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <>
      <h2 id={id}>{title}</h2>
      {children}
    </>
  );
}

/** A "Why" that folds out: the reason behind a rule, for whoever wants it. */
function Why({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="tech">
      <summary>{title}</summary>
      <div className="in">{children}</div>
    </details>
  );
}

/**
 * A guide's frame: the text, and beside it the contents (the mock-up's
 * `.two-col`, with the contents in an `.aside` card). Printed, the guide alone.
 */
function Guide({
  title,
  lede,
  contents,
  children,
}: {
  title: string;
  lede: string;
  contents: readonly { id: string; title: string }[];
  children: ReactNode;
}) {
  const siteName = plainSiteName(useSite().data);
  return (
    <StaffPage eyebrow={`${siteName} · Guides`} title={title} lede={lede}>
      <div className="two-col">
        <div className="prose">{children}</div>
        {/* Not numbered by the list: the steps carry their own numbers. */}
        <aside className="aside print:hidden">
          <nav className="card plain" aria-label="Contents">
            <h3>Contents</h3>
            <ol className="steps" style={{ gap: 6 }}>
              {contents.map((c) => (
                <li key={c.id}>
                  <span>
                    <a href={`#${c.id}`}>{c.title}</a>
                  </span>
                </li>
              ))}
            </ol>
          </nav>
        </aside>
      </div>
    </StaffPage>
  );
}

export function GuidesIndex() {
  const siteName = plainSiteName(useSite().data);
  return (
    <StaffPage
      eyebrow={`${siteName} · Guides`}
      title="Guides"
      lede="How to run this archive once it is installed: making a logbook, deciding who reviews, and checking it all works."
    >
      <div className="areas">
        <Link className="area-card" to="/docs/first-logbook">
          <h3>Your first logbook</h3>
          <p>
            Building the questions, the one decision that cannot be undone, appointing somebody to
            review, and filing a report through the whole path.
          </p>
        </Link>
        <Link className="area-card" to="/docs/checking">
          <h3>Checking it actually works</h3>
          <p>What to try in a browser on every new deployment, and how anybody checks a report.</p>
        </Link>
      </div>
      <p className="m">
        Installing the software on a server is described in the deployment’s own runbook, which
        ships with the deployment files rather than on this site.
      </p>
    </StaffPage>
  );
}

export function FirstLogbookGuide() {
  return (
    <Guide
      title="Your first logbook"
      lede="A deployment with no logbook accepts no reports at all, and that is deliberate. Every report is filed through a logbook, and a logbook is a questionnaire you build."
      contents={[
        { id: 'logbook-or-list', title: 'A logbook or a list' },
        { id: 'create', title: '1 · Make the draft' },
        { id: 'questions', title: '2 · Ask your questions' },
        { id: 'read', title: '3 · Read it as a reporter, before you launch' },
        { id: 'launch', title: '4 · Launch it: this is the one-way door' },
        { id: 'review', title: '5 · Somebody to review what arrives' },
        { id: 'walk', title: '6 · File one for real, through the whole path' },
      ]}
    >
      <p>
        There is no built-in form to fall back on and no second way in. Until one logbook is
        launched, there is nothing to file to. Take your time over this, because one decision in it
        cannot be undone.
      </p>

      <Section id="logbook-or-list" title="A logbook or a list">
        <p>
          A form is the question set. A logbook or a list is what happens to the answers. Both are
          built from the same kinds of question. The choice between them is one question:{' '}
          <strong>does this need to be permanent and checkable?</strong>
        </p>
        <ul>
          <li>
            A <strong>logbook</strong> seals every report, chains it to the one before, never lets
            anything be changed or deleted afterwards, asks every reporter to agree to what the form
            says, and publishes nothing until a moderator approves it.
          </li>
          <li>
            A <strong>list</strong> seals nothing. Its form can be changed, it erases the personal
            half of what it collects after a while, it is reviewed in batches, and it publishes
            counts rather than anything a person wrote. It is for things that do not need protecting
            from silent change: links to published material, a tally of how a day went, a contact
            form. Lists are made under <Link to="/lists">Lists</Link>.
          </li>
        </ul>
        <Why title="Why a list is not a logbook with the guarantees turned off">
          <p>
            A hard rule with a switch in front of it is not a hard rule. Sealing, never changing
            what was filed, and approval before publication are what the archive rests on. The
            failure nobody would notice is somebody flipping a switch on a logbook and quietly
            losing one of them.
          </p>
        </Why>
      </Section>

      <Section id="create" title="1 · Make the draft">
        <p>
          Sign in, open <Link to="/logbooks">Logbooks</Link>, and make one. It asks for two things.
        </p>
        <ul>
          <li>
            <strong>A title.</strong> Reporters see it. A place, a period, a subject: whatever tells
            somebody they are filing to the right one. “Munich, November 2026” is the shape.
          </li>
          <li>
            <strong>A web address.</strong> Made from the title if you leave it. It is sealed into
            every report filed here and can never be changed: each logbook is its own chain, named
            by it. A typo in it is fixed by deleting the draft and making another.
          </li>
        </ul>
        <p>
          Start from one of the shipped question sets rather than an empty form: Election incidents,
          Log how voting went, Incident reports, or the general Reports. Each arrives as a draft you
          can change freely. You can also start from nothing, or from a logbook file downloaded from
          another deployment; it always arrives as a draft.
        </p>
      </Section>

      <Section id="questions" title="2 · Ask your questions">
        <p>
          Add questions one at a time. For each one you also decide whether an answer is needed,
          whether it is offered as a filter on the board, and whether it is asked only when an
          earlier answer was a particular value. Nothing is a filter unless you say so: there is no
          built-in date or place filter, because when and where are questions here, not fixed parts
          of a report.
        </p>
        <p>Three things people get wrong:</p>
        <ul>
          <li>
            <strong>
              Do not ask for contact details, consent, or whether it may be published.
            </strong>{' '}
            The form already asks for an address when it needs one, and asks the publication
            question itself. Asking again stores a second copy in the wrong place.
          </li>
          <li>
            <strong>A written account is not built in.</strong> If you want one, and most logbooks
            do, ask for it as a long text question.
          </li>
          <li>
            <strong>A follow-up needs fixed answers to follow.</strong> The earlier question has to
            be yes or no, choose one, choose any, or evidence they have.
          </li>
        </ul>
      </Section>

      <Section id="read" title="3 · Read it as a reporter, before you launch">
        <p>
          Read every question aloud as if you had never seen it. It is the only way to notice a
          question that is clear to the person who wrote it and ambiguous to everybody else.
        </p>
        <p>
          A draft cannot be filed to, and a filed report can never be deleted: a test report in a
          launched logbook stays in its chain for good. The safest place to practise is a test
          deployment: download the logbook as a file, upload it there, launch it and file as often
          as you like.
        </p>
      </Section>

      <Section id="launch" title="4 · Launch it: this is the one-way door">
        <p>
          <strong>Launching cannot be undone.</strong> Afterwards a logbook may gain a new optional
          question and have its wording made clearer (labels, help, and the labels of coded
          options), and nothing else: no removing, no reordering, no changing a kind or a code, and
          no making an optional question required. Each rewording is a new version of the form.
        </p>
        <Why title="Why a launched form is frozen">
          <p>
            Every report seals the questions it was answered against: the version the reporter was
            actually asked. Changing a launched form would leave reports in one logbook that cannot
            be read against one definition. Adding an optional question is safe only because an
            unanswered question leaves no trace in a report at all, and rewording is safe because
            each report keeps the version its reporter saw.
          </p>
        </Why>
        <p>
          A logbook can be given an opening and a closing time, and closed or reopened by hand.
          Closing it stops new reports; everything already filed stays published and checkable.
          Launching puts it on the front page as a button wearing its own title, which you can
          rearrange or hide under <Link to="/logbooks/front-page">Front page</Link>.
        </p>
      </Section>

      <Section id="review" title="5 · Somebody to review what arrives">
        <p>
          <strong>Nothing is public until a moderator approves it.</strong> There is no automatic
          publishing and there never will be. A deployment that expects reports should have somebody
          whose job that is. Appoint them under <Link to="/access">Access</Link>: their email
          address and a role. They sign in with a one-time code sent to that address, every time, so
          email has to work first, and then prove a second factor: an authenticator app or a
          passkey. Until they have, they act with no role at all.
        </p>
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Can appoint</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Moderator</td>
              <td>Nobody</td>
            </tr>
            <tr>
              <td>Access Manager</td>
              <td>Moderators, not other Access Managers</td>
            </tr>
            <tr>
              <td>Administrator</td>
              <td>Moderators and Access Managers, not other administrators</td>
            </tr>
            <tr>
              <td>Owner</td>
              <td>
                All of those, administrators and journalists. There is exactly one owner, and the
                seat is only ever handed over, never granted.
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          Administrators can moderate too, once they accept the moderator agreement; a moderator
          cannot administer. A moderator may publish a report’s text and hold back its files, never
          the reverse: the reporter’s consent is the ceiling, and moderation the floor.
        </p>
      </Section>

      <Section id="walk" title="6 · File one for real, through the whole path">
        <p>
          With the logbook open and a moderator appointed, file a report yourself. If the form asks
          for an email address, <strong>follow the confirmation link in the email</strong>: the
          report is not filed until you do. A form of choices only files the report the moment it is
          sent.
        </p>
        <Why title="Why the email link matters most">
          <p>
            A path that only runs when somebody clicks a link in an email is the path nothing
            reaches by accident. Report confirmation was once broken in production for three days
            while every automated test passed, because none of them followed a confirmation link.
            Follow it once by hand on every deployment.
          </p>
        </Why>
        <p>Then you have a working archive, and its address is worth giving out.</p>
      </Section>
    </Guide>
  );
}

export function CheckingGuide() {
  return (
    <Guide
      title="Checking it actually works"
      lede="What to try in a browser on a new deployment, and how anybody can check a report without trusting this site."
      contents={[
        { id: 'browser', title: 'In a browser' },
        { id: 'report', title: 'Checking a report' },
      ]}
    >
      <Section id="browser" title="In a browser">
        <ol>
          <li>
            If the site password is on, the password screen appears, and the password gets you past
            it.
          </li>
          <li>Your deployment’s own name, not “ReportLog”, is in the browser tab.</li>
          <li>
            You can <Link to="/access/sign-in">sign in</Link> with a one-time code sent by email,
            and then your second factor.
          </li>
          <li>
            You can build a logbook, launch it, file a test report, and, if the form asks for an
            address, confirm it from the link in the email. That path is only reached by a person
            clicking a link.
          </li>
          <li>A moderator can approve it, and only then does it appear on the board.</li>
        </ol>
      </Section>

      <Section id="report" title="Checking a report">
        <p>
          Every report is fingerprinted when it is filed and chained to the report before it in its
          logbook, so any later change shows. Anybody holding a report’s reference can check it on
          its own page, at <code>/verify/</code> followed by the reference. The check runs in the
          reader’s own browser, with the same code the server sealed the report with.
        </p>
        <p>
          Once a day the newest report of every logbook is timestamped by an outside authority and
          published. A logbook on that list stays on every later one, and its count only grows, so a
          whole logbook cannot quietly disappear.
        </p>
      </Section>
    </Guide>
  );
}
