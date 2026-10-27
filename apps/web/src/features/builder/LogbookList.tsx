/**
 * Every logbook, drafts included, and making a new one
 * (settings-and-admin.md §08).
 *
 * One row per logbook, as a raised panel: its title, its state as a chip,
 * its filing address in mono, and Open. Making one is behind a primary
 * "Make a logbook" button rather than always open on the page.
 *
 * The site-wide intake switch ("New reports, across the site") moved to the
 * settings overview as "Accepting reports" (features/settings/Switches.tsx):
 * it is the whole site's state, not a logbook's. This page links to it.
 */
import { createLogbook, createLogbookFromFile } from '@reportlog/contracts';
import type { LogbookDetail } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { Chip } from '../../components/ui/chip.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { FileDrop } from '../../components/ui/file-drop.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { RowItem, Rows, rowLink } from '../../components/ui/rows.tsx';
import { RadioGroup, RadioOption } from '../../components/ui/radio-group.tsx';
import { call } from '../../lib/api.ts';
import { Field, Panel, Problem, TextInput } from './controls.tsx';
import { logbooksQuery, startingPointsQuery } from './queries.ts';
import { stateLabel, stateWords } from './words.ts';

export function LogbookList() {
  const query = useQuery(logbooksQuery());
  const [making, setMaking] = useState(false);
  const make = (
    <Button
      aria-expanded={making}
      onClick={() => {
        setMaking(!making);
      }}
    >
      Make a logbook
    </Button>
  );
  return (
    <StaffPage
      title="Logbooks"
      lede="A logbook is a permanent, checkable record: once launched, its reports are sealed and chained."
      // One "Make" button at a time: an empty page carries it in its empty state.
      actions={making || query.data?.logbooks.length === 0 ? null : make}
    >
      <p className="text-ink-alt">
        Whether reports are taken at all is on{' '}
        <Link to="/settings" className="underline underline-offset-4">
          Site settings
        </Link>
        . The front page’s buttons are on{' '}
        <Link to="/logbooks/front-page" className="underline underline-offset-4">
          Front page
        </Link>
        .
      </p>

      {making ? (
        <NewLogbook
          onCancel={() => {
            setMaking(false);
          }}
        />
      ) : null}

      {query.isPending && <p role="status">Reading the logbooks…</p>}
      {query.isError && <Problem error={query.error} />}
      {query.isSuccess &&
        (query.data.logbooks.length === 0 ? (
          making ? null : (
            <Empty title="No logbooks yet">
              Make one to start taking reports.
              <span className="mt-3 flex justify-center">{make}</span>
            </Empty>
          )
        ) : (
          <Rows label="Logbooks">
            {query.data.logbooks.map((l) => (
              <RowItem key={l.id}>
                <Link
                  to="/logbooks/$id"
                  params={{ id: l.id }}
                  aria-label={`Open ${l.title}`}
                  className={rowLink('end')}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-display font-bold">{l.title}</span>
                    <span className="font-mono text-[0.78rem] break-all text-muted">
                      /file/{l.slug} · {l.question_count} question
                      {l.question_count === 1 ? '' : 's'} ·{' '}
                      {l.asks_for_files
                        ? l.files_frozen_at
                          ? 'files frozen'
                          : 'asks for files'
                        : 'no files'}
                    </span>
                    <span className="text-sm text-ink-alt">{stateWords(l)}</span>
                  </span>
                  <Chip
                    tone={l.state === 'open' ? 'confirmed' : l.state === 'draft' ? 'off' : 'tag'}
                  >
                    {stateLabel[l.state]}
                  </Chip>
                </Link>
              </RowItem>
            ))}
          </Rows>
        ))}
    </StaffPage>
  );
}

function NewLogbook({ onCancel }: { onCancel: () => void }) {
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
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="primary" busy={make.isPending} busyLabel="Making it…">
            Make the draft
          </Button>
          <Button type="button" variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        </div>
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
