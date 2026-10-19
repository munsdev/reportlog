/**
 * Every logbook, drafts included, and making a new one.
 *
 * THE WHOLE TILE OPENS IT: opening a logbook is the only thing anybody comes
 * to its row to do, so the row is one link rather than a card with a small
 * button in the corner.
 */
import { createLogbook, createLogbookFromFile } from '@reportlog/contracts';
import type { LogbookDetail } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { call } from '../../lib/api.ts';
import { Field, Panel, Problem, TextInput } from './controls.tsx';
import { logbooksQuery, startingPointsQuery } from './queries.ts';
import { IntakeSwitchPanel } from './Switches.tsx';
import { stateLabel, stateWords } from './words.ts';

export function LogbookList() {
  const query = useQuery(logbooksQuery());
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold">Logbooks</h1>
        <p className="max-w-prose text-ink-alt">
          A logbook is one named place to file reports, with its own questions. Every report in it
          is fingerprinted and chained to the one before.
        </p>
        <Link to="/logbooks/front-page" className="underline">
          Arrange the front page’s buttons
        </Link>
      </header>

      {query.isPending && <p role="status">Reading the logbooks…</p>}
      {query.isError && <Problem error={query.error} />}
      {query.isSuccess &&
        (query.data.logbooks.length === 0 ? (
          <p>No logbooks yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2" aria-label="Logbooks">
            {query.data.logbooks.map((l) => (
              <li key={l.id}>
                <Link
                  to="/logbooks/$id"
                  params={{ id: l.id }}
                  className="block h-full space-y-1 rounded-card border border-line bg-surface p-4 hover:bg-paper-alt"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{l.title}</span>
                    <span className="rounded-card border border-line px-2 text-sm">
                      {stateLabel[l.state]}
                    </span>
                  </span>
                  <span className="block text-sm text-ink-alt">{stateWords(l)}</span>
                  <span className="block font-mono text-sm text-muted">
                    /{l.slug} · {l.question_count} question{l.question_count === 1 ? '' : 's'} ·{' '}
                    {l.asks_for_files
                      ? l.files_frozen_at
                        ? 'files frozen'
                        : 'asks for files'
                      : 'no files'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}

      <NewLogbook />
      <IntakeSwitchPanel />
    </div>
  );
}

function NewLogbook() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const points = useQuery(startingPointsQuery());
  const [from, setFrom] = useState('none');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');

  // Straight into the builder: the next thing anybody does is look at it.
  const opened = async (lb: LogbookDetail) => {
    await qc.invalidateQueries({ queryKey: logbooksQuery().queryKey });
    await navigate({ to: '/logbooks/$id', params: { id: lb.id } });
  };
  const make = useMutation({
    mutationFn: () =>
      call(createLogbook, {
        body: {
          title,
          ...(slug.trim() ? { slug: slug.trim() } : {}),
          ...(from === 'none' ? {} : { starting_point: from }),
        },
      }),
    onSuccess: opened,
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error('That file is not a logbook file: it is not JSON at all.');
      }
      return call(createLogbookFromFile, { body: { file: parsed } });
    },
    onSuccess: opened,
  });
  const chosen = points.data?.starting_points.find((p) => p.id === from);

  return (
    <Panel title="Make a logbook">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          make.mutate();
        }}
      >
        <fieldset className="space-y-2">
          <legend className="font-semibold">Start from</legend>
          {/* "Start from nothing" is FIRST and chosen by default: a list whose
              first choice is somebody else's questions reads as a recommendation. */}
          <StartChoice
            value="none"
            current={from}
            onPick={setFrom}
            title="Start from nothing"
            detail="An empty draft. You add every question yourself."
          />
          {points.data?.starting_points.map((p) => (
            <StartChoice
              key={p.id}
              value={p.id}
              current={from}
              onPick={setFrom}
              title={p.title}
              detail={`${p.blurb ? `${p.blurb} ` : ''}${String(p.questions)} questions${
                p.typed ? '' : ', all of them choices'
              }${p.takes_files ? ', and a place for files' : ', and no files'}.`}
            />
          ))}
        </fieldset>

        <Field
          label="Title"
          help={
            chosen ? `Leave empty to call it “${chosen.title}”.` : 'What the logbook is called.'
          }
        >
          {(p) => (
            <TextInput
              {...p}
              value={title}
              maxLength={120}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label="Web address (optional)"
          help="Lowercase letters, numbers and hyphens. Made from the title if you leave it empty. It can never be changed afterwards."
        >
          {(p) => (
            <TextInput
              {...p}
              value={slug}
              maxLength={63}
              spellCheck={false}
              onChange={(e) => {
                setSlug(e.target.value);
              }}
            />
          )}
        </Field>
        <p className="text-sm text-muted">
          It is made as a draft. Nobody sees it until you launch it.
        </p>
        <Problem error={make.error} />
        <Button type="submit" variant="primary" disabled={make.isPending}>
          Make the draft
        </Button>
      </form>

      <Field
        label="Or upload a logbook file"
        help="A file downloaded from a logbook here or elsewhere. It makes a new draft."
      >
        {(p) => (
          <input
            {...p}
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
            }}
          />
        )}
      </Field>
      <Problem error={upload.error} />
    </Panel>
  );
}

function StartChoice(props: {
  value: string;
  current: string;
  onPick: (v: string) => void;
  title: string;
  detail: string;
}) {
  const id = `start-${props.value}`;
  return (
    <div className="flex items-start gap-2 rounded-card border border-line p-3">
      <input
        id={id}
        type="radio"
        name="starting-point"
        className="mt-1 size-4"
        checked={props.current === props.value}
        onChange={() => {
          props.onPick(props.value);
        }}
      />
      <label htmlFor={id}>
        <span className="block font-semibold">{props.title}</span>
        <span className="block text-sm text-muted">{props.detail}</span>
      </label>
    </div>
  );
}
