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
import { useContactList } from '../features/lists/contact.ts';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CopyText } from '../components/ui/copy-text.tsx';
import { PublicPage } from '../features/site-pages/PublicPage.tsx';
import { Panel } from '../mockup/Panel.tsx';
import { useSite } from '../components/ui/site.tsx';

export const Route = createFileRoute('/terms')({
  component: TermsPage,
});

function TermsPage() {
  const form = useContactList();
  const site = useSite();
  return (
    <PublicPage
      variant="band"
      title="Terms of use and contact"
      eyebrow="Legal"
      aside={
        <Panel title="Related">
          <ul style={{ display: 'grid', gap: 6, listStyle: 'none', padding: 0, margin: 0 }}>
            <li>
              <Link to="/legal">Imprint and privacy</Link>
            </li>
            <li>
              <Link to="/standards">Moderation standard</Link>
            </li>
            <li>
              <Link to="/illegal-content">Report illegal content</Link>
            </li>
          </ul>
        </Panel>
      }
      asideLabel="Related"
      lede="What this site does with what you send it, and who to write to."
    >
      {site.isPending ? <p role="status">Loading…</p> : null}
      {site.isError ? <p role="alert">{site.error.message}</p> : null}

      <section aria-labelledby="t-reports">
        <h2 id="t-reports">Reports</h2>
        <p>
          A report is published only after a moderator approves it, and only if you said it may be
          published. Approving a report is a judgement that it may be published, not a finding that
          it is true.
        </p>
        <p>
          If a moderator decides not to publish your report, and your email address is still
          readable, we email you the reason, chosen from a fixed list, and a link to these terms. If
          you erased your address, or the form did not ask for one, we cannot write to you, and the
          decision stands.
        </p>
      </section>

      <section aria-labelledby="t-tips">
        <h2 id="t-tips">Tips and links</h2>
        <p>
          A tip is a message to the people who run this site. It is never published. Links in a tip
          may be checked, withheld, removed, and reported to a hotline or the authorities. A link
          that has been checked may be passed to a small group of vetted journalists, in the same
          way a message is forwarded; that is not publication. Removing a link or a tip sends no
          notice.
        </p>
      </section>

      <section aria-labelledby="t-illegal">
        <h2 id="t-illegal">Illegal content</h2>
        <p>
          If you think something here is illegal, use the{' '}
          <Link to="/illegal-content">form to report illegal content</Link>. You get a receipt, and
          if you give an address, the decision with its reason.
        </p>
      </section>

      <section aria-labelledby="t-own">
        <h2 id="t-own">The operator’s own terms</h2>
        <CopyText slot="terms_of_use" />
      </section>

      <section aria-labelledby="t-users">
        <h2 id="t-users">Contact for people who use this site</h2>
        <CopyText slot="contact_users" />
        {form ? (
          <p>
            <Link className="btn sm flat" to="/$slug" params={{ slug: form.slug }}>
              Write to us
            </Link>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="t-auth">
        <h2 id="t-auth">Contact for authorities</h2>
        <CopyText slot="contact_authorities" />
      </section>

      <p className="m">
        The imprint and privacy policy are on the <Link to="/legal">imprint and privacy</Link> page.
      </p>
    </PublicPage>
  );
}
