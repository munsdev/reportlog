/**
 * About: two parts, in this order on purpose.
 *
 * PART ONE IS THE OPERATOR'S: who runs this archive and why, in the
 * `about_archive` slot, then how filing works here in brief. PART TWO IS
 * THE SOFTWARE'S, says ReportLog because that is what it describes, and no
 * operator can rewrite it: an operator who could edit the explanation of
 * sealing could make it say something the code does not do.
 *
 * The order is also the answer to "why should I trust this". The operator
 * says who they are; then the software says do not take their word for it,
 * here is what you can check yourself.
 *
 * Every claim in part two is one the rebuild enforces; keep it that way
 * when either changes.
 */
import { SOFTWARE_LICENCE, SOFTWARE_NAME, SOFTWARE_SOURCE } from '@reportlog/contracts';
import { Link, createFileRoute } from '@tanstack/react-router';
import { CopyText } from '../components/ui/copy-text.tsx';
import { PublicPage } from '../features/site-pages/PublicPage.tsx';
import { Contents, ProseSection } from '../components/ui/prose-section.tsx';
import { plainSiteName, useSite } from '../components/ui/site.tsx';

export const Route = createFileRoute('/about')({
  component: AboutPage,
});

const PART_TWO = [
  { id: 'chain', title: 'Each report is sealed, and linked to the one before it' },
  { id: 'witness', title: 'Once a day, somebody else timestamps the record' },
  { id: 'check', title: 'You do not have to take anybody’s word for it' },
  { id: 'database', title: 'The rule is enforced below the application' },
  { id: 'who-sees', title: 'What is published, and what is kept apart' },
  { id: 'moderation', title: 'Nothing is public until a person approves it' },
  { id: 'roles', title: 'One kind of administrator cannot create more of itself' },
  { id: 'hosting', title: 'No third parties in the page' },
  { id: 'limits', title: 'What this deliberately cannot do' },
  { id: 'source', title: 'Free software, and you can read all of it' },
] as const;

const link = 'underline underline-offset-2';

function AboutPage() {
  const name = plainSiteName(useSite().data);
  return (
    <PublicPage title={`About ${name}`} width="prose">
      <Contents
        label="Contents"
        items={[
          { id: 'what', title: 'What this is' },
          { id: 'how-it-works', title: 'How it works, briefly' },
          ...PART_TWO,
        ]}
      />

      <ProseSection id="what" label="Part one · 01" title="What this is">
        <CopyText slot="about_archive" />
      </ProseSection>

      <ProseSection id="how-it-works" label="02" title="How it works, briefly">
        <p>
          You file a report. A moderator reads it before anybody else does and decides whether it is
          published. Nothing appears on the public board until that has happened, and there is no
          path that skips it.
        </p>
        <p>
          Once a report is filed it is sealed. It is never edited and never deleted: not by a
          moderator, not by whoever runs this archive, not by the people who wrote the software. A
          correction is filed as a new version beside the original, and both are kept. A report can
          be withdrawn from public view, and the fact that it was withdrawn is itself part of the
          record.
        </p>
        <p>
          <Link to="/how" className={link}>
            How to use this
          </Link>{' '}
          says what filing looks like step by step. The{' '}
          <Link to="/standards" className={link}>
            moderation standard
          </Link>{' '}
          says what gets published here.
        </p>
      </ProseSection>

      {/* The divide between the operator's part and the software's: a plain
          panel's rule, and the second part named for what it offers. */}
      <div className="flex flex-col gap-2 border-t-2 border-ink-alt pt-6">
        <p className="label-face text-xs text-muted">Part two · what you can check yourself</p>
        <h2 className="font-display text-section">About the software</h2>
        <p>
          Everything below describes {SOFTWARE_NAME}, the software this archive runs on. It is the
          same on every deployment, and none of it is written or controlled by whoever runs this
          one.
        </p>
      </div>

      <ProseSection id="chain" label="03 · The chain" title={PART_TWO[0].title}>
        <p>
          When a report is filed, its contents are put into one object, written out in a single
          canonical form (RFC 8785) and fingerprinted with SHA-256. The fingerprint covers the
          report’s own reference, so a report cannot be renumbered afterwards either.
        </p>
        <p>
          Each report also carries the fingerprint of the report before it in the same logbook. That
          makes each logbook a chain: changing anything in an old report changes its fingerprint,
          which breaks every link after it.
        </p>
        <p>
          Every logbook is its own chain. The first report in a logbook links to a starting value
          made from the logbook’s name, so a report cannot be moved from one chain to another
          without it showing.
        </p>
        <p>
          A field is written into the sealed object only when it applies. An absent field and an
          empty one are different things, and keeping them different is what lets a logbook gain a
          new optional question without changing the fingerprint of a single report already filed.
        </p>
      </ProseSection>

      <ProseSection id="witness" label="04 · The outside witness" title={PART_TWO[1].title}>
        <p>
          A chain proves it is consistent with itself and nothing more: whoever holds the database
          could rebuild the whole thing and it would still agree with itself. So once a day a list
          of every logbook’s latest link is sent to an independent timestamp authority, which
          returns an RFC 3161 token: evidence from somebody else that the record looked exactly like
          that at that moment.
        </p>
        <p>
          Once a logbook is on that list it stays on it, and its count of reports can only grow.
          With separate chains, a whole logbook could otherwise disappear without any other chain
          noticing; the list is what notices.
        </p>
        <p>
          The list and its token are published to a transparency log kept in git repositories that
          other people can hold copies of. The log is never rewritten, not even to correct it. If
          something is found that invalidates published proofs, that fact is published beside them.
        </p>
      </ProseSection>

      <ProseSection id="check" label="05 · Checking it yourself" title={PART_TWO[2].title}>
        <p>
          Every published report shows its fingerprint. Anybody can take the report as published,
          rebuild the object, fingerprint it and compare. The{' '}
          <Link to="/docs/checking" className={link}>
            checking guide
          </Link>{' '}
          explains how, and the check page does it in your own browser with the same code the server
          sealed with.
        </p>
        <p>
          The code that builds the object on the way in and the code that rebuilds it on the way out
          sit side by side and are tested against each other, because a checker that agrees with the
          writer by accident is not a checker. Nothing about the check needs this server to be
          honest, or even to exist.
        </p>
      </ProseSection>

      <ProseSection id="database" label="06 · Append-only" title={PART_TWO[3].title}>
        <p>
          The tables that hold reports, the versions of the questions they were answered against,
          their files and the daily anchors refuse changes in the database itself: a trigger rejects
          any attempt to update or delete a row. That is deliberately not left to the application,
          because an application is one bug away from doing the wrong thing and a trigger is not.
        </p>
        <p>
          The database also checks every new report’s link to the one before it, and refuses to let
          a logbook’s questions change once it has opened, other than by adding an optional one or
          making the wording clearer. A rewording is a new version of the questions, and every
          report keeps the version its reporter was asked.
        </p>
      </ProseSection>

      <ProseSection id="who-sees" label="07 · Who can see what" title={PART_TWO[4].title}>
        <p>
          The report itself, the answers to the logbook’s questions, is what gets published once a
          moderator approves it and the person who filed it has allowed that.
        </p>
        <p>
          Who filed it is kept apart and encrypted. A moderator or administrator can open it only by
          proving their second factor again and giving a reason, the opening is recorded before
          anything is shown, and the person who filed can see that record on their own report, with
          the reason but without the staff member’s name. A report filed through a form that asked
          for no address holds nobody’s details at all.
        </p>
      </ProseSection>

      <ProseSection id="moderation" label="08 · Moderation" title={PART_TWO[5].title}>
        <p>
          There is no automatic publishing in the software and there must not be. A moderator reads
          every report before it appears. What a moderator approves and refuses is a judgement, and
          it belongs to whoever runs this archive. A deployment publishes its own standard on the{' '}
          <Link to="/standards" className={link}>
            moderation standard
          </Link>{' '}
          page.
        </p>
      </ProseSection>

      <ProseSection id="roles" label="09 · The role ceiling" title={PART_TWO[6].title}>
        <p>
          An Access Manager can appoint and remove moderators. They cannot appoint another Access
          Manager: if they could, the role would spread on its own and the ceiling would not be a
          ceiling. Only the owner appoints or removes an administrator, and no grant can make
          somebody the owner.
        </p>
      </ProseSection>

      <ProseSection id="hosting" label="10 · Where it runs" title={PART_TWO[7].title}>
        <p>
          The page loads no fonts, scripts, maps or trackers from anywhere else, so reading this
          archive does not tell any third party that you did. Where this deployment is hosted, and
          under which law, is for its operator to state in the{' '}
          <Link to="/legal" className={link}>
            imprint and privacy policy
          </Link>
          .
        </p>
      </ProseSection>

      <ProseSection id="limits" label="11 · The honest limits" title={PART_TWO[8].title}>
        <p>
          <strong>It cannot tell you a report is true.</strong> It can tell you that a report was
          filed at a certain time, has not been changed since, and was reviewed by a moderator.
          Whether what it describes happened is a separate question, and the archive does not
          pretend to answer it.
        </p>
        <p>
          <strong>It cannot prove nothing was left out.</strong> The chain shows that what is here
          has not been changed. A report that was never filed leaves no trace.
        </p>
        <p>
          <strong>It cannot protect somebody who names themselves in the text.</strong> Contact
          details are kept apart and encrypted; an answer that names its own author is published as
          written.
        </p>
      </ProseSection>

      <ProseSection id="source" label="12 · The source" title={PART_TWO[9].title}>
        <p>
          {SOFTWARE_NAME} is licensed {SOFTWARE_LICENCE}. Every claim on this page can be checked
          against the source rather than taken on trust, which is the point of publishing it.
        </p>
        <p>
          <a href={SOFTWARE_SOURCE} rel="noopener" className={link}>
            {SOFTWARE_SOURCE.replace(/^https:\/\//, '')}
          </a>
        </p>
        <p>
          What changed in each release is in the{' '}
          <a href={`${SOFTWARE_SOURCE}/blob/main/CHANGELOG.md`} rel="noopener" className={link}>
            changelog
          </a>
          .
        </p>
        <p>
          Whoever runs this archive did not write the software, and cannot change what it does for
          the people using it without publishing that change too. That is what the licence is for.
        </p>
      </ProseSection>
    </PublicPage>
  );
}
