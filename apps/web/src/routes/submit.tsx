/**
 * Where the front page's "File" button goes: ONE CARD, ONE QUESTION. Every
 * report is filed through a logbook, and a link or tip goes through the tips
 * list, so this asks which, takes the answer, and moves on only when the
 * confirm button is pressed. Choosing an answer never moves anybody on, even
 * when there is only one to choose (nothing on a card changes underneath
 * somebody, and no card advances by itself).
 *
 * THE QUESTION IS THE OPERATOR'S WORDING (`submit_question`, "What are you
 * reporting?" until they write one; ElectionLog's is "What do you want to
 * do?"), and each answer is named by what it opens: a logbook by its title,
 * the tips list by its own title ("Send a link"), so renaming one renames its
 * answer. The operator's intro (`submit_intro`) is drawn under the question,
 * and the card waits for the wording to load, so the page is drawn once.
 */
import { listOpenLists, listPublicLogbooks } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../components/ui/button.tsx';
import { Field, FieldError } from '../components/ui/field.tsx';
import { Label } from '../components/ui/label.tsx';
import { CopyText } from '../components/ui/copy-text.tsx';
import { Page } from '../components/ui/page.tsx';
import { RadioGroup, RadioOption } from '../components/ui/radio-group.tsx';
import { useSite } from '../components/ui/site.tsx';
import { call } from '../lib/api.ts';

const openLogbooksQuery = queryOptions({
  queryKey: ['logbooks', 'public', 'open'],
  queryFn: ({ signal }) => call(listPublicLogbooks, { query: { include: 'open' }, signal }),
});

const openListsQuery = queryOptions({
  queryKey: ['lists', 'open'],
  queryFn: ({ signal }) => call(listOpenLists, { signal }),
});

/** The list that takes a link, photo or video as a tip. */
export const TIPS_SLUG = 'tips';

export const Route = createFileRoute('/submit')({
  component: Submit,
});

function Submit() {
  const logbooks = useQuery(openLogbooksQuery);
  const lists = useQuery(openListsQuery);
  const site = useSite();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  if (logbooks.isPending || lists.isPending || site.isPending) return <p role="status">Loading…</p>;
  if (logbooks.isError) return <p role="alert">{logbooks.error.message}</p>;
  const open = logbooks.data.logbooks;
  // A tips list that failed to load is no reason to hide the logbooks.
  const tips = lists.data?.lists.find((l) => l.slug === TIPS_SLUG);
  const choices = [
    ...open.map((l) => ({ value: `logbook:${l.slug}`, label: l.title, hint: l.blurb })),
    ...(tips ? [{ value: `list:${tips.slug}`, label: tips.title, hint: tips.blurb }] : []),
  ];
  const go = () => {
    const [kind, slug] = chosen.split(':');
    if (!slug) {
      setProblem('Choose one of the answers to go on.');
      return;
    }
    if (kind === 'list') void navigate({ to: '/list/$slug', params: { slug } });
    else void navigate({ to: '/file/$slug', params: { slug } });
  };
  return (
    <Page title={site.data?.copy.submit_question || 'What are you reporting?'} width="prose">
      <CopyText slot="submit_intro" />
      {choices.length === 0 ? (
        <p>Nothing is taking reports at the moment. Please come back later.</p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
        >
          <Field>
            <Label>Choose one</Label>
            <RadioGroup
              value={chosen}
              onValueChange={(v) => {
                setProblem(null);
                setChosen(v);
              }}
            >
              {choices.map((c) => (
                <RadioOption key={c.value} value={c.value} label={c.label} hint={c.hint} />
              ))}
            </RadioGroup>
            <FieldError>{problem}</FieldError>
          </Field>
          <div>
            <Button type="submit">Continue</Button>
          </div>
        </form>
      )}
    </Page>
  );
}
