/**
 * The moderation standard: the written rule a moderator applies, and that
 * anybody can hold them to. Its own page, as in legacy, so it can be linked
 * to on its own (a moderator application, the About page).
 *
 * The words are the operator's (`standards`). Until written, the shipped
 * wording says plainly that it is not a standard yet, never something that
 * reads like one.
 */
import { createFileRoute } from '@tanstack/react-router';
import { Alert } from '../components/ui/alert.tsx';
import { CopyText } from '../components/ui/copy-text.tsx';
import { PublicPage } from '../features/site-pages/PublicPage.tsx';
import { useSite } from '../components/ui/site.tsx';

export const Route = createFileRoute('/standards')({
  component: StandardsPage,
});

function StandardsPage() {
  const site = useSite();
  return (
    <PublicPage
      title="Moderation standard"
      width="prose"
      lede="What gets published here, what is held back, and who decides."
    >
      {site.isPending ? <p role="status">Loading…</p> : null}
      {site.isError ? (
        <Alert tone="serious" title="The standard could not be loaded">
          {site.error.message}
        </Alert>
      ) : null}
      <CopyText slot="standards" />
      <p className="text-sm text-ink-alt">
        Holding a report back is not a finding that it is false, and publishing one is not a finding
        that it is true. A moderator judges whether an account may be published, nothing more.
      </p>
    </PublicPage>
  );
}
