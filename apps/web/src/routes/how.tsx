/**
 * How to use this: one page with four tabs, so nothing here needs a page of
 * its own. Filing, what happens after a report is filed, how the record can
 * be checked, and the figures API for developers. The selected tab is in
 * the address (`?tab=`) so a link can point at one; the old addresses
 * /public-api and /docs/checking redirect here.
 *
 * The operator's own words go above (`how_intro`, optional, so an unwritten
 * one shows nothing). The instructions are the software's and describe what
 * this code does; keep them true when the filing form changes.
 */
import { SOFTWARE_LICENCE, SOFTWARE_NAME, SOFTWARE_SOURCE } from '@reportlog/contracts';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { AsideCard } from '../components/ui/band.tsx';
import { Button } from '../components/ui/button.tsx';
import { CopyText } from '../components/ui/copy-text.tsx';
import { ProseSection } from '../components/ui/prose-section.tsx';
import { DeveloperTab } from '../features/site-pages/DeveloperTab.tsx';
import { PublicPage } from '../features/site-pages/PublicPage.tsx';
import { cn } from '../lib/utils.ts';

const TABS = [
  { id: 'filing', label: 'Filing' },
  { id: 'next', label: 'What happens next' },
  { id: 'record', label: 'The record and checking' },
  { id: 'developers', label: 'For developers' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export const Route = createFileRoute('/how')({
  validateSearch: (s: Record<string, unknown>): { tab?: TabId } => {
    const tab = TABS.find((t) => t.id === s.tab)?.id;
    return tab ? { tab } : {};
  },
  component: HowPage,
});

const link = 'underline underline-offset-2';

function HowPage() {
  const tab = Route.useSearch().tab ?? 'filing';
  const navigate = useNavigate();
  const go = (id: TabId) => {
    void navigate({ to: '/how', search: id === 'filing' ? {} : { tab: id }, replace: true });
  };
  return (
    <PublicPage
      variant="band"
      title="How to use this"
      eyebrow="How it works"
      band={
        // The band's tabs (mock-up .tabs): a row of buttons that scrolls
        // inside itself, so the page never does.
        <div
          role="tablist"
          aria-label="How to use this"
          className="-mx-1 mt-1.5 flex overflow-x-auto border-b border-line [scrollbar-width:none]"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`how-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`how-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => {
                go(t.id);
              }}
              onKeyDown={(e) => {
                const i = TABS.findIndex((x) => x.id === tab);
                const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                const next = TABS[(i + step + TABS.length) % TABS.length];
                if (step && next) {
                  e.preventDefault();
                  go(next.id);
                  document.getElementById(`how-tab-${next.id}`)?.focus();
                }
              }}
              className={cn(
                'label-face -mb-px inline-flex min-h-12 shrink-0 items-center border-b-[3px] px-4 text-[0.8125rem] whitespace-nowrap',
                tab === t.id
                  ? 'border-ink text-ink'
                  : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
      aside={
        <>
          <AsideCard title="On this page" plain>
            <ol className="grid list-none gap-1 p-0">
              {TABS.map((t, i) => (
                <li key={t.id} className="grid grid-cols-[34px_1fr] items-center">
                  <span aria-hidden="true" className="font-display text-xl text-ink">
                    {i + 1}
                  </span>
                  <Link
                    to="/how"
                    search={t.id === 'filing' ? {} : { tab: t.id }}
                    aria-current={tab === t.id ? 'page' : undefined}
                    className="inline-flex min-h-11 items-center underline underline-offset-4 aria-[current=page]:font-bold"
                  >
                    {t.label}
                  </Link>
                </li>
              ))}
            </ol>
          </AsideCard>
          <AsideCard title="Check a report">
            <p>Confirm a report has not been changed since it was filed.</p>
            <Button asChild variant="secondary" className="justify-self-start">
              <Link to="/verify">Check</Link>
            </Button>
          </AsideCard>
        </>
      }
      asideLabel="On this page"
    >
      <CopyText slot="how_intro" />
      <div
        role="tabpanel"
        id={`how-panel-${tab}`}
        aria-labelledby={`how-tab-${tab}`}
        className="flex max-w-[66ch] flex-col gap-8"
      >
        {tab === 'filing' ? <Filing /> : null}
        {tab === 'next' ? <Next /> : null}
        {tab === 'record' ? <Record /> : null}
        {tab === 'developers' ? <DeveloperTab /> : null}
      </div>
    </PublicPage>
  );
}

function Filing() {
  return (
    <>
      <ProseSection id="filing" label="01" title="Filing a report, one question at a time">
        <p>
          Every report is filed into a logbook: a set of questions about one kind of event. Choose{' '}
          <Link to="/submit" className={link}>
            what you are reporting
          </Link>
          , and the form asks its questions one card at a time. You press Next when you are ready.
        </p>
        <p>
          Your browser’s Back button goes back one question. Before anything is sent you see every
          answer together, and can change any of them.
        </p>
      </ProseSection>

      <ProseSection id="publishing" label="02" title="Whether it may be published">
        <p>
          You are asked whether your report may be published, and the exact wording of that question
          is kept with your answer. If you say no, it is kept in the archive and never shown on the
          public board. Some logbooks exist to be public: there, the last card tells you that filing
          means your report may be published once a moderator approves it.
        </p>
      </ProseSection>

      <ProseSection
        id="confirming"
        label="03"
        title="Confirming by email, when you are asked for an address"
      >
        <p>
          A form that lets you type, takes files, or asks whether you have evidence asks for your
          email address, and we send a link to it. Nothing is filed until you open that link and
          confirm. The link works for 90 days. This stops anybody filing in somebody else’s name.
          Your address is kept apart from your report and encrypted. It is never published.
        </p>
        <p>
          A form of choices only does not ask for an address. Your report is filed the moment you
          send it, with no confirmation, and nothing ties it to you, so you cannot come back to
          correct or withdraw it.
        </p>
      </ProseSection>
    </>
  );
}

function Next() {
  return (
    <>
      <ProseSection id="afterwards" label="04" title="A moderator reads it before anybody else">
        <p>
          Once filed, your report is given a reference and can no longer be changed by anybody. A
          moderator reads it before it appears anywhere. There is no automatic publishing, and no
          path that skips the moderator. What a moderator approves or refuses is a judgement, and it
          belongs to whoever runs this archive, who publishes the{' '}
          <Link to="/standards" className={link}>
            moderation standard
          </Link>
          .
        </p>
        <p>
          How many reports arrived and when, how many were declined and why, and every time intake
          was paused are on the{' '}
          <Link to="/board/activity" className={link}>
            arrivals and declines
          </Link>{' '}
          page.
        </p>
      </ProseSection>

      <ProseSection id="yours" label="05" title="Your reports afterwards">
        <p>
          If you gave an address, sign in with it and open{' '}
          <Link to="/mine" className={link}>
            your reports
          </Link>
          . From there you can file a correction (a new version; the original is kept beside it),
          change the permissions you give, withdraw a report from the public board, or erase your
          address for good. A withdrawn report stays in the archive, and the fact that it was
          withdrawn is part of the record.
        </p>
      </ProseSection>
    </>
  );
}

function Record() {
  return (
    <>
      <ProseSection id="checking" label="06" title="Checking a report">
        <p>
          Every report has a reference. Enter it on the{' '}
          <Link to="/verify" className={link}>
            check page
          </Link>{' '}
          to check, in your own browser, that it has not been changed since it was filed. You do not
          have to take anybody’s word for it: the check uses the same code that sealed the report,
          and needs nothing from this server to be honest.
        </p>
        <p>
          Each report’s fingerprint (SHA-256, of the report written out in one canonical form, RFC
          8785) is combined with the one before it in the same logbook, so changing anything in an
          old report breaks every link after it. Once a day, the newest link of every logbook is
          sent to an independent timestamp authority (RFC 3161) and published to a transparency log
          that is never rewritten. A logbook on that list stays on it, and its count only grows, so
          a whole logbook cannot quietly disappear.
        </p>
        <p>
          The database itself refuses to update or delete a report, and checks every new report’s
          link to the one before it. The questions of a launched logbook can only gain an optional
          question or clearer wording; every report keeps the version its reporter was asked.
        </p>
        <p>
          To try it on a new deployment: file a test report, confirm it from the email link if the
          form asks for an address, have a moderator approve it, and check it on the check page.
        </p>
      </ProseSection>

      <ProseSection id="who-sees" label="07" title="What is published, and what is kept apart">
        <p>
          The answers to the logbook’s questions are published once a moderator approves the report
          and the person who filed it has allowed that. Who filed it is kept apart and encrypted. A
          moderator can open it only by proving their second factor again and giving a reason, and
          the person who filed can see that it was opened. A report filed through a form that asked
          for no address holds nobody’s details at all.
        </p>
        <p>
          The page loads no fonts, scripts, maps or trackers from anywhere else, so reading this
          archive does not tell any third party that you did. Where this deployment is hosted is in
          the{' '}
          <Link to="/legal" className={link}>
            imprint and privacy policy
          </Link>
          .
        </p>
      </ProseSection>

      <ProseSection id="limits" label="08" title="What this deliberately cannot do">
        <p>
          <strong>It cannot tell you a report is true.</strong> It can tell you that a report was
          filed, has not been changed since, and was reviewed by a moderator.
        </p>
        <p>
          <strong>It cannot prove nothing was left out.</strong> A report that was never filed
          leaves no trace.
        </p>
        <p>
          <strong>It cannot protect somebody who names themselves in the text.</strong> An answer
          that names its own author is published as written.
        </p>
      </ProseSection>

      <ProseSection id="source" label="09" title="Free software, and you can read all of it">
        <p>
          {SOFTWARE_NAME} is licensed {SOFTWARE_LICENCE}. Whoever runs this archive did not write
          the software, and cannot change what it does for the people using it without publishing
          that change too.
        </p>
        <p>
          <a href={SOFTWARE_SOURCE} rel="noopener" className={link}>
            {SOFTWARE_SOURCE.replace(/^https:\/\//, '')}
          </a>{' '}
          ·{' '}
          <a href={`${SOFTWARE_SOURCE}/blob/main/CHANGELOG.md`} rel="noopener" className={link}>
            changelog
          </a>
        </p>
      </ProseSection>
    </>
  );
}
