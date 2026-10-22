/**
 * How to use this: what filing looks like, what happens afterwards, and
 * how to check a report. Its own page rather than a part of About: About
 * argues for the archive, this describes the software, and somebody who has
 * already decided to file should not have to read the case for the project
 * to find out how.
 *
 * The operator's own words go above (`how_intro`, optional, so an unwritten
 * one shows nothing rather than a placeholder on a page somebody came to
 * for help). The instructions are the software's and describe what this
 * code does; keep them true when the filing form changes.
 */
import { Link, createFileRoute } from '@tanstack/react-router';
import { CopyText } from '../components/ui/copy-text.tsx';
import { PublicPage } from '../features/site-pages/PublicPage.tsx';
import { Contents, ProseSection } from '../components/ui/prose-section.tsx';

export const Route = createFileRoute('/how')({
  component: HowPage,
});

const SECTIONS = [
  { id: 'filing', title: 'Filing a report, one question at a time' },
  { id: 'publishing', title: 'Whether it may be published' },
  { id: 'confirming', title: 'Confirming by email' },
  { id: 'afterwards', title: 'A moderator reads it before anybody else' },
  { id: 'yours', title: 'Your reports afterwards' },
  { id: 'checking', title: 'Checking a report' },
] as const;

const link = 'underline underline-offset-2';

function HowPage() {
  return (
    <PublicPage title="How to use this" width="prose">
      <CopyText slot="how_intro" />
      <Contents label="On this page" items={SECTIONS} />

      <ProseSection id="filing" label="01" title={SECTIONS[0].title}>
        <p>
          Every report is filed into a logbook: a set of questions about one kind of event. Choose{' '}
          <Link to="/submit" className={link}>
            what you are reporting
          </Link>
          , and the form asks its questions one card at a time. Nothing on a card changes while you
          are answering it, and choosing an answer never moves you on by itself: you press Next when
          you are ready.
        </p>
        <p>
          Your browser’s Back button goes back one question. Before anything is sent you see every
          answer together, and can change any of them.
        </p>
      </ProseSection>

      <ProseSection id="publishing" label="02" title={SECTIONS[1].title}>
        <p>
          You are asked whether your report may be published, and the exact wording of that question
          is sealed into your report with your answer. If you say no, it is kept in the archive and
          never shown on the public board.
        </p>
      </ProseSection>

      <ProseSection id="confirming" label="03" title={SECTIONS[2].title}>
        <p>
          You give an email address, and we send a link to it. Nothing is filed until you open that
          link and confirm. The link works for 24 hours. This stops anybody filing in somebody
          else’s name.
        </p>
        <p>Your address is kept apart from your report and encrypted. It is never published.</p>
      </ProseSection>

      <ProseSection id="afterwards" label="04" title={SECTIONS[3].title}>
        <p>
          Once confirmed, your report is sealed: it is given a reference and a fingerprint, and it
          can no longer be changed by anybody. A moderator reads it before it appears anywhere.
          Nothing is published automatically.
        </p>
      </ProseSection>

      <ProseSection id="yours" label="05" title={SECTIONS[4].title}>
        <p>
          Sign in with the address you filed from and open{' '}
          <Link to="/mine" className={link}>
            your reports
          </Link>
          . From there you can file a correction (a new version; the original is kept beside it),
          take back permissions you gave, or withdraw a report from the public board. A withdrawn
          report stays in the archive, and the fact that it was withdrawn is part of the record.
        </p>
      </ProseSection>

      <ProseSection id="checking" label="06" title={SECTIONS[5].title}>
        <p>
          Every report has a reference. Enter it in “Check a report” on the{' '}
          <Link to="/" className={link}>
            front page
          </Link>{' '}
          to check, in your own browser, that it has not been changed since it was filed. The{' '}
          <Link to="/docs/checking" className={link}>
            checking guide
          </Link>{' '}
          goes further, and{' '}
          <Link to="/about" className={link}>
            About
          </Link>{' '}
          explains why the check can be trusted.
        </p>
      </ProseSection>
    </PublicPage>
  );
}
