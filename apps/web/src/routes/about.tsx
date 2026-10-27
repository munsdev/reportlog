/**
 * About: who runs this archive and why (the `about_archive` slot, the
 * operator's own words), then how filing works here in brief. How the
 * record can be checked, and the software behind it, are on How to use this.
 * The page is the mock-up's: a band, the text, and cards to what comes next.
 */
import { Link, createFileRoute } from '@tanstack/react-router';
import { Button } from '../components/ui/button.tsx';
import { AsideCard, Prose } from '../components/ui/band.tsx';
import { CopyText } from '../components/ui/copy-text.tsx';
import { PublicPage } from '../features/site-pages/PublicPage.tsx';
import { plainSiteName, useSite } from '../components/ui/site.tsx';

export const Route = createFileRoute('/about')({
  component: AboutPage,
});

function AboutPage() {
  const name = plainSiteName(useSite().data);
  return (
    <PublicPage
      variant="band"
      title={`About ${name}`}
      eyebrow="About"
      aside={
        <>
          <AsideCard title="Read the reports">
            <p>Everything published so far.</p>
            <Button asChild variant="secondary" className="justify-self-start">
              <Link to="/board">Reports</Link>
            </Button>
          </AsideCard>
          <AsideCard title="Get involved">
            <p>Moderate, bring your group, or spread the word.</p>
            <Button asChild variant="secondary" className="justify-self-start">
              <Link to="/get-involved">How to help</Link>
            </Button>
          </AsideCard>
          <AsideCard title="Contact" plain>
            <p>For questions about the project or a report you filed.</p>
            <Link to="/terms" hash="t-users" className="underline underline-offset-4">
              Who to write to
            </Link>
          </AsideCard>
        </>
      }
      asideLabel="Next steps"
    >
      <Prose id="what" aria-labelledby="what-title">
        <h2 id="what-title">What this is</h2>
        <CopyText slot="about_archive" />
        <h2 id="how-it-works">How it works, briefly</h2>
        <p>
          You file a report. A moderator reads it before anybody else does and decides whether it is
          published. Nothing appears on the public board until that has happened, and there is no
          path that skips it.
        </p>
        <p>
          <Link to="/how">How to use this</Link> says what filing looks like step by step, and how
          the record can be checked. The <Link to="/standards">moderation standard</Link> says what
          gets published here.
        </p>
      </Prose>
    </PublicPage>
  );
}
