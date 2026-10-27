/**
 * Where the front page's "File" button goes: ONE CARD, ONE QUESTION. Every
 * report is filed through a logbook, and a link or tip goes through the tips
 * list, so this asks which, takes the answer, and moves on only when Next
 * is pressed. Choosing an answer never moves anybody on, even
 * when there is only one to choose (nothing on a card changes underneath
 * somebody, and no card advances by itself).
 *
 * THE QUESTION IS THE OPERATOR'S WORDING (`submit_question`, "What are you
 * reporting?" until they write one; the voting starting point's is "What do you want to
 * do?"), on the same card frame as every filing card, and each answer is named by what it opens: a logbook by its title,
 * the tips list by its own title ("Send a link"), so renaming one renames its
 * answer. The operator's intro (`submit_intro`) is drawn under the question,
 * and the card waits for the wording to load, so the page is drawn once.
 */
import { listOpenLists, listPublicLogbooks } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Note } from '@/mockup/Note.tsx';
import { CopyText } from '../components/ui/copy-text.tsx';
import { Empty } from '../components/ui/empty.tsx';
import { DEFAULT_CTA_HEADING } from '../features/form/HelpNow.tsx';
import { useSite } from '../components/ui/site.tsx';
import { BtnLink } from '../mockup/Btn.tsx';
import { useCardTitle } from '../features/form/CardFrame.tsx';
import { FormColumn, FormNotice } from '../features/form/FormNotice.tsx';
import { call } from '../lib/api.ts';

const openLogbooksQuery = queryOptions({
  queryKey: ['logbooks', 'public', 'open'],
  queryFn: ({ signal }) => call(listPublicLogbooks, { query: { include: 'open' }, signal }),
});

const openListsQuery = queryOptions({
  queryKey: ['lists', 'open'],
  queryFn: ({ signal }) => call(listOpenLists, { signal }),
});

/** The list that takes a link as a tip. */
export const TIPS_SLUG = 'tips';

export const Route = createFileRoute('/submit')({
  component: Submit,
});

function Submit() {
  const logbooks = useQuery(openLogbooksQuery);
  const lists = useQuery(openListsQuery);
  const site = useSite();
  const question = site.data?.copy.submit_question ?? 'What are you reporting?';
  useCardTitle(question);
  if (logbooks.isPending || lists.isPending || site.isPending) {
    return (
      <FormColumn>
        <p role="status">Loading…</p>
      </FormColumn>
    );
  }
  if (logbooks.isError) {
    return (
      <FormNotice title={question}>
        <Note tone="serious" title="What is open could not be loaded">
          {logbooks.error.message}
        </Note>
      </FormNotice>
    );
  }
  const open = logbooks.data.logbooks;
  // A tips list that failed to load is no reason to hide the logbooks.
  const tips = lists.data?.lists.find((l) => l.slug === TIPS_SLUG);
  const choices = [
    ...open.map((l) => ({
      value: `logbook:${l.slug}`,
      to: '/file/$slug' as const,
      params: { slug: l.slug },
      tag: 'Logbook',
      action: 'File a report',
      label: l.title,
      hint: l.blurb,
    })),
    ...(tips
      ? [
          {
            value: `list:${tips.slug}`,
            to: '/list/$slug' as const,
            params: { slug: tips.slug },
            tag: 'List',
            action: 'Send a link',
            label: tips.title,
            hint: tips.blurb,
          },
        ]
      : []),
  ];
  if (choices.length === 0) {
    return (
      <FormNotice title={question}>
        <CopyText slot="submit_intro" />
        <Empty title="Nothing is open">
          Nothing is taking reports at the moment. Please come back later.
        </Empty>
      </FormNotice>
    );
  }
  const help = site.data?.copy;
  const helpUrl = help?.cta_button_url.trim();
  const helpLabel = help?.cta_button_text.trim();
  return (
    <FormColumn>
      <div style={{ paddingTop: 28 }}>
        <div style={{ display: 'grid', gap: 14, maxWidth: 720 }}>
          <span className="eyebrow">File a report</span>
          <h1 className="h-page" id="submit-question">
            {question}
          </h1>
          <CopyText slot="submit_intro" className="lead" />
        </div>
        {/* The mock-up's chooser: each answer is a card that is a link, so
            choosing opens it. No card here moves anybody on without a press. */}
        <div className="cards" style={{ paddingTop: 26, maxWidth: 960 }}>
          {choices.map((c) => (
            <Link
              key={c.value}
              to={c.to}
              params={c.params}
              className="card"
              style={{ textDecoration: 'none' }}
            >
              <span className="tag">{c.tag}</span>
              <h3>{c.label}</h3>
              {c.hint ? <p>{c.hint}</p> : null}
              <span className={c.tag === 'Logbook' ? 'btn go sm flat' : 'btn sm flat'}>
                {c.action}
              </span>
            </Link>
          ))}
        </div>
        {help?.help_now ? (
          <section className="section" style={{ maxWidth: 720 }}>
            <div className="cta urgent">
              <span className="mark">Before you start</span>
              <h3>{help.cta_heading.trim() || DEFAULT_CTA_HEADING}</h3>
              <p className="whitespace-pre-wrap">{help.help_now}</p>
              {helpLabel && helpUrl ? (
                <BtnLink sm flat href={helpUrl}>
                  {helpLabel}
                </BtnLink>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </FormColumn>
  );
}
