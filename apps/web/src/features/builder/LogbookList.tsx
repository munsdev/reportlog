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
import { LogbooksTabs } from './LogbooksTabs.tsx';
import { createLogbook, createLogbookFromFile } from '@reportlog/contracts';
import type { LogbookDetail } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Btn } from '@/mockup/Btn.tsx';
import { RadioGroup, RadioOption } from '@/mockup/Choice.tsx';
import { Empty } from '@/mockup/Empty.tsx';
import { FileDrop } from '@/mockup/FileDrop.tsx';
import { rowCols, RowItem, Rows } from '@/mockup/Rows.tsx';
import { St } from '@/mockup/St.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { Field, Panel, Problem, TextInput } from './controls.tsx';
import { logbooksQuery, startingPointsQuery } from './queries.ts';
import { stateLabel, stateWords } from './words.ts';

export function LogbookList() {
  const query = useQuery(logbooksQuery());
  const [making, setMaking] = useState(false);
  const make = (
    <Btn
      look="ink"
      sm
      flat
      aria-expanded={making}
      onClick={() => {
        setMaking(!making);
      }}
    >
      Make a logbook
    </Btn>
  );
  return (
    <StaffPage
      title="Logbooks"
      tabs={<LogbooksTabs />}
      lede="A logbook is a permanent, checkable record: once launched, its reports are sealed and chained."
      // One "Make" button at a time: an empty page carries it in its empty state.
      actions={making || query.data?.logbooks.length === 0 ? null : make}
    >
      <p className="muted">
        Whether reports are taken at all is on <Link to="/settings">Site settings</Link>. The front
        page’s buttons are on <Link to="/logbooks/front-page">Front page</Link>.
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
              <span className="acts">{make}</span>
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
                  className="row"
                  style={rowCols('1fr auto')}
                >
                  <span>
                    <span className="t">{l.title}</span>
                    <br />
                    <span className="m">
                      /file/{l.slug} · {l.question_count} question
                      {l.question_count === 1 ? '' : 's'} ·{' '}
                      {l.asks_for_files
                        ? l.files_frozen_at
                          ? 'files frozen'
                          : 'asks for files'
                        : 'no files'}
                    </span>
                    <br />
                    <span className="m">{stateWords(l)}</span>
                  </span>
                  <span>
                    <St
                      tone={l.state === 'open' ? 'confirmed' : l.state === 'draft' ? 'off' : 'tag'}
                    >
                      {stateLabel[l.state]}
                    </St>
                  </span>
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
        className="panel"
        style={{ border: 0, padding: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          make.mutate();
        }}
      >
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          <legend className="lbl">Start from</legend>
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
        <p className="muted">It is made as a draft. Nobody sees it until you launch it.</p>
        <Problem error={make.error} />
        <div className="acts">
          <Btn look="ink" sm flat type="submit" busy={make.isPending} busyLabel="Making it…">
            Make the draft
          </Btn>
          <Btn look="ghost" sm flat type="button" onClick={onCancel}>
            Cancel
          </Btn>
        </div>
      </form>

      <div className="field">
        <p id="upload-logbook-label" className="lbl">
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
