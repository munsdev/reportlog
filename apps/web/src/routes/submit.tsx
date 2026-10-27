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
import { Alert } from '../components/ui/alert.tsx';
import { CopyText } from '../components/ui/copy-text.tsx';
import { Empty } from '../components/ui/empty.tsx';
import { Wrap } from '../components/ui/band.tsx';
import { Eyebrow } from '../components/ui/type.tsx';
import { HelpNow } from '../features/form/HelpNow.tsx';
import { useSite } from '../components/ui/site.tsx';
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
        <Alert tone="serious" title="What is open could not be loaded">
          {logbooks.error.message}
        </Alert>
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
  return (
    <div data-bleed>
      <Wrap className="grid max-w-[56rem] gap-6 pt-8 pb-16">
        <div className="grid gap-2.5">
          <Eyebrow>File a report</Eyebrow>
          <h1 id="submit-question" className="font-display text-title">
            {question}
          </h1>
          <CopyText slot="submit_intro" className="text-lede text-ink-alt" />
        </div>
        {/* The mock-up's chooser: each answer is a card that is a link, so
            choosing opens it. No card here moves anybody on without a press. */}
        <ul
          aria-labelledby="submit-question"
          className="grid list-none gap-4 p-0 min-[820px]:grid-cols-3"
        >
          {choices.map((c) => (
            <li key={c.value} className="flex">
              <Link
                to={c.to}
                params={c.params}
                className="grid w-full content-start gap-2.5 rounded-card border-(length:--rl-border-main) border-ink bg-surface p-[18px] text-ink no-underline shadow-raised"
              >
                <span className="font-mono text-xs tracking-[0.1em] text-muted uppercase">
                  {c.tag}
                </span>
                <span className="font-display text-[1.35rem] leading-none">{c.label}</span>
                {c.hint ? <span className="text-[0.95rem] text-ink-alt">{c.hint}</span> : null}
                <span className="label-face mt-1 inline-flex min-h-11 items-center justify-self-start rounded-control border-control border-ink bg-action px-4.5 text-[0.84375rem] text-on-action">
                  {c.action}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {help?.help_now ? (
          <HelpNow
            text={help.help_now}
            heading={help.cta_heading}
            buttonLabel={help.cta_button_text}
            buttonUrl={help.cta_button_url}
            mini
          />
        ) : null}
      </Wrap>
    </div>
  );
}
