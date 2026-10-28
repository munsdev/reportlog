/**
 * About: who runs this archive and why (the `about_archive` slot, the
 * operator's own words), then how filing works here in brief. How the
 * record can be checked, and the software behind it, are on How to use this.
 * The page is the mock-up's about.html: a band, the text, and cards to what
 * comes next.
 */
import { useContactList } from '../features/lists/contact.ts';
import { hasAdminAuthority } from '@reportlog/access';
import { Link, createFileRoute } from '@tanstack/react-router';
import { CopyText } from '../components/ui/copy-text.tsx';
import { plainSiteName, useSite } from '../components/ui/site.tsx';
import { useMe } from '../features/identity/session.ts';
import { Band, MockPage } from '../mockup/Band.tsx';
import { Card, TwoCol } from '../mockup/TwoCol.tsx';
import { useBodyClass } from '../mockup/useBodyClass.ts';

export const Route = createFileRoute('/about')({
  component: AboutPage,
});

function AboutPage() {
  const site = useSite().data;
  const name = plainSiteName(site);
  const me = useMe().data;
  const admin = me?.signedIn === true && hasAdminAuthority(me.roles);
  // The contact wording itself, where the card used to send people to find
  // it ("Who to write to", which read as a sentence that stopped).
  const contact = site?.copy.contact_users ?? '';
  // The site's contact form, when one is marked and open (lists/contact.ts).
  const form = useContactList();
  useBodyClass('light');
  return (
    <MockPage>
      <Band eyebrow="About" title={'A record,\nnot a ruling'} tabTitle={`About ${name}`} motif />
      <TwoCol
        asideLabel="Next steps"
        aside={
          <>
            <Card title="Read the reports">
              <p>Everything published so far.</p>
              <Link className="btn sm flat" to="/board">
                Reports
              </Link>
            </Card>
            <Card title="Get involved">
              <p>Moderate, bring your group, or spread the word.</p>
              <Link className="btn sm flat" to="/get-involved">
                How to help
              </Link>
            </Card>
            {contact || form ? (
              <Card title="Contact" plain>
                <p>For questions about the project or a report you filed{contact ? ':' : '.'}</p>
                <CopyText slot="contact_users" />
                {form ? (
                  <Link className="btn sm flat" to="/list/$slug" params={{ slug: form.slug }}>
                    Write to us
                  </Link>
                ) : null}
              </Card>
            ) : admin ? (
              // Nothing written yet: visitors see no card that says nothing,
              // and an administrator is told what fills it.
              <Card title="Contact" plain>
                <p className="muted">
                  Visitors see no contact card yet. Mark a list as the contact form on Front page
                  and pages, or choose Edit, then “Edit this page’s words”, and write the contact
                  for people who use this site.
                </p>
              </Card>
            ) : null}
          </>
        }
      >
        <div className="prose">
          <h2>What this is</h2>
          <CopyText slot="about_archive" />
          <h2>What happens after you send it</h2>
          <ol className="steps">
            <li>
              <span>
                <b>You file a report.</b>
                You get a reference right away.
              </span>
            </li>
            <li>
              <span>
                <b>A moderator reads it.</b>
                They read it before anybody else does and decide whether it is published. They do
                not investigate whether it is true.
              </span>
            </li>
            <li>
              <span>
                <b>If it meets the standard, it is published.</b>
                Nothing appears on the public board until that has happened, and there is no path
                that skips it.
              </span>
            </li>
            <li>
              <span>
                <b>It stays on the record.</b>
                If you left an address, you can add a correction or withdraw it; the original stays
                in the record with a note.
              </span>
            </li>
          </ol>
          <h2>What this is not</h2>
          <ul>
            <li>
              <span>
                <b>Not an emergency line.</b> If someone is in danger, call your local emergency
                number.
              </span>
            </li>
            <li>
              <span>
                <b>Not a ruling on what&rsquo;s true.</b> A published report means a person said
                this happened and a moderator read it.
              </span>
            </li>
            <li>
              <span>
                <b>Not a survey.</b> People choose to file. The numbers show what was reported, not
                how common anything was.
              </span>
            </li>
          </ul>
          <p>
            <Link to="/how">How to use this</Link> says what filing looks like step by step, and how
            the record can be checked. The <Link to="/standards">moderation standard</Link> says
            what gets published here.
          </p>
          <p className="muted" style={{ fontSize: '.9rem' }}>
            How the record is protected:{' '}
            <Link to="/how" search={{ tab: 'record' }}>
              The record &amp; checking
            </Link>
          </p>
        </div>
      </TwoCol>
    </MockPage>
  );
}
