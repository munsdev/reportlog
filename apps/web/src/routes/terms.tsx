/**
 * The terms of use and the two contact points (D4).
 *
 * The first half is the SOFTWARE's: what it does with a report, a tip and a
 * link. It is written here and is not an editable slot, because an operator
 * who could rewrite it could make the terms say something the software does
 * not do. The second half is the operator's, in three slots (the words
 * settings page): their own part of the terms, a contact point for people who
 * use the site, and one for authorities. An unwritten slot says so, and is
 * never filled with something that reads like a real address.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { CopyText } from '../components/ui/copy-text.tsx';
import { PublicPage } from '../features/site-pages/PublicPage.tsx';
import { useSite } from '../components/ui/site.tsx';

export const Route = createFileRoute('/terms')({
  component: TermsPage,
});

function TermsPage() {
  const site = useSite();
  return (
    <PublicPage
      title="Terms of use and contact"
      width="prose"
      lede="What this site does with what you send it, and who to write to."
    >
      {site.isPending ? <p role="status">Loading…</p> : null}
      {site.isError ? <p role="alert">{site.error.message}</p> : null}

      <section aria-labelledby="t-reports" className="flex flex-col gap-2">
        <h2 id="t-reports" className="font-display text-xl font-bold">
          Reports
        </h2>
        <p>
          A report is published only after a moderator approves it, and only if you said it may be
          published. Approving a report is a judgement that it may be published, not a finding that
          it is true. Once filed, a report is sealed: it can be corrected with a new version, and a
          change shows.
        </p>
        <p>
          If a moderator decides not to publish your report, and your email address is still
          readable, we email you the reason, chosen from a fixed list, and a link to these terms. If
          you erased your address, we cannot write to you, and the decision stands.
        </p>
      </section>

      <section aria-labelledby="t-tips" className="flex flex-col gap-2">
        <h2 id="t-tips" className="font-display text-xl font-bold">
          Tips and links
        </h2>
        <p>
          A tip is a message to the people who run this site. It is never published. Links in a tip
          may be checked, withheld, removed, and reported to a hotline or the authorities. A link
          that has been checked may be passed to a small group of vetted journalists, in the same
          way a message is forwarded; that is not publication. Removing a link or a tip sends no
          notice.
        </p>
      </section>

      <section aria-labelledby="t-illegal" className="flex flex-col gap-2">
        <h2 id="t-illegal" className="font-display text-xl font-bold">
          Illegal content
        </h2>
        <p>
          If you think something here is illegal, use the{' '}
          <Link to="/illegal-content" className="underline">
            form to report illegal content
          </Link>
          . You get a receipt, and if you give an address, the decision with its reason.
        </p>
      </section>

      <section aria-labelledby="t-own" className="flex flex-col gap-2">
        <h2 id="t-own" className="font-display text-xl font-bold">
          The operator’s own terms
        </h2>
        <CopyText slot="terms_of_use" />
      </section>

      <section aria-labelledby="t-users" className="flex flex-col gap-2">
        <h2 id="t-users" className="font-display text-xl font-bold">
          Contact for people who use this site
        </h2>
        <CopyText slot="contact_users" />
      </section>

      <section aria-labelledby="t-auth" className="flex flex-col gap-2">
        <h2 id="t-auth" className="font-display text-xl font-bold">
          Contact for authorities
        </h2>
        <CopyText slot="contact_authorities" />
      </section>

      <p className="text-sm text-ink-alt">
        The imprint and privacy policy are on the{' '}
        <Link to="/legal" className="underline">
          imprint and privacy
        </Link>{' '}
        page.
      </p>
    </PublicPage>
  );
}
