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
import { FileDrop } from '../../components/ui/file-drop.tsx';
import { RadioGroup, RadioOption } from '../../components/ui/radio-group.tsx';
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
        <h1 className="font-display text-title font-bold">Logbooks</h1>
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
          <RadioGroup
            aria-label="Start from"
            name="starting-point"
            value={from}
            onValueChange={setFrom}
          >
            {/* "Start from nothing" is FIRST and chosen by default: a list whose
              first choice is somebody else's questions reads as a recommendation. */}
            <StartChoice
              value="none"
              title="Start from nothing"
              detail="An empty draft. You add every question yourself."
            />
            {points.data?.starting_points.map((p) => (
              <StartChoice
                key={p.id}
                value={p.id}
                title={p.title}
                detail={`${p.blurb ? `${p.blurb} ` : ''}${String(p.questions)} questions${
                  p.typed ? '' : ', all of them choices'
                }${p.takes_files ? ', and a place for files' : ', and no files'}.`}
              />
            ))}
          </RadioGroup>
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

      <div className="flex flex-col gap-1">
        <p id="upload-logbook-label" className="font-semibold">
          Or upload a logbook file
        </p>
        <FileDrop
          labelledBy="upload-logbook-label"
          accept="application/json,.json"
          limits="A file downloaded from a logbook here or elsewhere. It makes a new draft."
          onFiles={(files) => {
            const file = files[0];
            if (file) upload.mutate(file);
          }}
        />
      </div>
      <Problem error={upload.error} />
    </Panel>
  );
}

function StartChoice(props: { value: string; title: string; detail: string }) {
  return (
    <RadioOption
      id={`start-${props.value}`}
      value={props.value}
      label={props.title}
      hint={props.detail}
    />
  );
}
