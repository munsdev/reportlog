/**
 * About: who runs this archive and why (the `about_archive` slot, the
 * operator's own words), then how filing works here in brief. How the
 * record can be checked, and the software behind it, are on How to use this.
 */
import { Link, createFileRoute } from '@tanstack/react-router';
import { CopyText } from '../components/ui/copy-text.tsx';
import { PublicPage } from '../features/site-pages/PublicPage.tsx';
import { ProseSection } from '../components/ui/prose-section.tsx';
import { plainSiteName, useSite } from '../components/ui/site.tsx';

export const Route = createFileRoute('/about')({
  component: AboutPage,
});

const link = 'underline underline-offset-2';

function AboutPage() {
  const name = plainSiteName(useSite().data);
  return (
    <PublicPage title={`About ${name}`} width="prose">
      <ProseSection id="what" title="What this is">
        <CopyText slot="about_archive" />
      </ProseSection>

      <ProseSection id="how-it-works" title="How it works, briefly">
        <p>
          You file a report. A moderator reads it before anybody else does and decides whether it is
          published. Nothing appears on the public board until that has happened, and there is no
          path that skips it.
        </p>
        <p>
          <Link to="/how" className={link}>
            How to use this
          </Link>{' '}
          says what filing looks like step by step, and how the record can be checked. The{' '}
          <Link to="/standards" className={link}>
            moderation standard
          </Link>{' '}
          says what gets published here.
        </p>
      </ProseSection>
    </PublicPage>
  );
}
