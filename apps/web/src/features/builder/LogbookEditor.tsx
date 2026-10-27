/**
 * One logbook: its questions, launching it, and what can still change after
 * (settings-and-admin.md §09). The title with its state as a chip and the
 * two downloads beside it; each question a raised card with its kind and
 * what it needs as chips; after launch, a quiet panel saying what is frozen
 * and why; the switches; then launching or the times it takes reports.
 *
 * A launched logbook's questions are fixed, and the screen says WHY where the
 * controls used to be, rather than greying them out and leaving somebody to
 * guess. The one opening, a new optional question, stays offered.
 */
import {
  addQuestion,
  getCompleteChainFile,
  deleteLogbook,
  launchLogbook,
  removeQuestion,
  reorderQuestions,
  setLogbookClosed,
  setLogbookSchedule,
  updateLogbook,
  updateQuestion,
} from '@reportlog/contracts';
import type { LogbookDetail, Question } from '@reportlog/contracts';
import { canFilter, describeCondition, fieldType, isPublishedFreeText } from '@reportlog/fields';
import type { FieldDefinition } from '@reportlog/fields';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Panel as MPanel } from '@/mockup/Panel.tsx';
import { Dl } from '@/mockup/Dl.tsx';
import { Btn, btnClass } from '@/mockup/Btn.tsx';
import { St } from '@/mockup/St.tsx';
import { RadioGroup, RadioOption } from '@/mockup/Choice.tsx';
import { SettingPanels } from '@/mockup/SettingPanel.tsx';
import { GuardedPanel } from '../settings/panels.tsx';
import { StepUpDownload } from '../identity/StepUp.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { CoverPanel } from './CoverPanel.tsx';
import { Check, Field, Panel, Problem, TextArea, TextInput } from './controls.tsx';
import { logbookQuery, logbooksQuery } from './queries.ts';
import { QuestionForm } from './QuestionForm.tsx';
import { RewordForm } from './RewordForm.tsx';
import type { QuestionBody } from './QuestionForm.tsx';
import { FreezePanel, OutsidePanel } from './Switches.tsx';
import { TypeToConfirm } from './TypeToConfirm.tsx';
import { fromLocalInput, stateLabel, stateWords, toLocalInput } from './words.ts';

const defs = (qs: readonly Question[]): FieldDefinition[] =>
  qs.map((q) => ({ ...q, settings: q.settings }));

export function LogbookEditor({ id }: { id: number }) {
  const query = useQuery(logbookQuery(id));
  if (query.isPending) return <p role="status">Opening the logbook…</p>;
  if (query.isError) {
    return (
      <div role="alert" className="panel">
        <p>{query.error.message}</p>
        <Link to="/logbooks" className="back">
          Back to the logbooks
        </Link>
      </div>
    );
  }
  return <Editor lb={query.data} />;
}

function Editor({ lb }: { lb: LogbookDetail }) {
  const qc = useQueryClient();
  const params = { id: lb.id };
  const launched = lb.state !== 'draft';
  /** Every change is followed by a fresh read, so the screen shows what the server holds. */
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: logbookQuery(lb.id).queryKey });
    await qc.invalidateQueries({ queryKey: logbooksQuery().queryKey, exact: true });
  };

  return (
    <StaffPage eyebrow={`Logbook · ${stateLabel[lb.state]}`} title={lb.title} lede={stateWords(lb)}>
      <Link to="/logbooks" className="back">
        ← All logbooks
      </Link>
      <div className="chips">
        <St tone={lb.state === 'open' ? 'confirmed' : lb.state === 'draft' ? 'off' : 'tag'}>
          {stateLabel[lb.state]}
        </St>
        <St tone="off">{lb.asks_for_files ? 'Takes files' : 'No files'}</St>
      </div>
      <p data-filing-address className="mono">
        /file/{lb.slug}
        {lb.short_slug ? ` · /${lb.short_slug}` : ''}
      </p>
      <Downloads lb={lb} launched={launched} />

      <SettingPanels>
        <div className="grid2 even">
          <Details lb={lb} refresh={refresh} />
          <CoverPanel
            kind="logbook"
            cover={lb.cover}
            save={async (cover) => {
              await call(updateLogbook, { params: { id: lb.id }, body: { cover } });
              await refresh();
            }}
          />
          <NotesRule lb={lb} refresh={refresh} />
          <EmailRule lb={lb} refresh={refresh} />
          <PublicationRule lb={lb} refresh={refresh} />
          <FrontPageSwitch lb={lb} refresh={refresh} />
          {launched && <Lifecycle lb={lb} refresh={refresh} />}
          <OutsidePanel lb={lb} refresh={refresh} />
          <FreezePanel lb={lb} refresh={refresh} />
        </div>
      </SettingPanels>

      <Panel title="Questions">
        {launched && (
          <MPanel kind="quiet">
            <p>
              {lb.launched_at ? `Launched on ${day(lb.launched_at)}. ` : ''}The questions’ keys,
              kinds, order, conditions and codes are frozen, so every sealed report still checks.
              You can reword a label or help, add an optional question at the end, and choose which
              questions the board offers as filters.
            </p>
          </MPanel>
        )}
        <QuestionList lb={lb} refresh={refresh} />
        <MPanel kind="quiet" title="Add a question" headingLevel={3}>
          <QuestionForm
            earlier={lb.fields}
            launched={launched}
            submitLabel="Add the question"
            onSubmit={async (body: QuestionBody, kind: string) => {
              await call(addQuestion, { params, body: { ...body, kind } });
              await refresh();
            }}
          />
        </MPanel>
      </Panel>

      {!launched && <Launch lb={lb} refresh={refresh} />}
      {!launched && <DeleteDraft lb={lb} />}
    </StaffPage>
  );
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The row of buttons under the address: the reporter's form, the logbook file (its title and
 * questions, to keep or to start another from), and, once it has launched,
 * its complete chain, which asks for the step-up first (plan E, E3).
 */
function Downloads({ lb, launched }: { lb: LogbookDetail; launched: boolean }) {
  return (
    <div className="acts">
      {launched ? (
        // Only a launched logbook has a form a reporter can open; a draft's
        // is not served to anybody, so the button is left out until then.
        <a
          href={`/file/${lb.slug}`}
          target="_blank"
          rel="noopener"
          className={btnClass({ sm: true, flat: true })}
        >
          Open the reporter’s form
        </a>
      ) : null}
      <a
        href={`/api/admin/logbooks/${String(lb.id)}/file`}
        download={`logbook-${lb.slug}.json`}
        className={btnClass({ sm: true, flat: true })}
      >
        The logbook file
      </a>
      {launched ? (
        <StepUpDownload
          href={getCompleteChainFile.path.replace(':slug', encodeURIComponent(lb.slug))}
          className={btnClass({ sm: true, flat: true })}
        >
          Its chain
        </StepUpDownload>
      ) : null}
    </div>
  );
}

/**
 * The five settings below are the mock-up's closed panels: a summary and a
 * Change button; open, a form with Save and Cancel inside it, one open at a
 * time (SettingPanels). Each keeps the save call it had before; only the
 * presentation moved. `GuardedPanel` also names unsaved changes if somebody
 * leaves the page.
 */

function Details({ lb, refresh }: { lb: LogbookDetail; refresh: () => Promise<void> }) {
  const [title, setTitle] = useState(lb.title);
  const [blurb, setBlurb] = useState(lb.blurb ?? '');
  const [short, setShort] = useState(lb.short_slug ?? '');
  const save = useMutation({
    mutationFn: () =>
      call(updateLogbook, {
        params: { id: lb.id },
        body: {
          title,
          blurb,
          ...(short.trim() !== (lb.short_slug ?? '') ? { short_slug: short.trim() || null } : {}),
        },
      }),
    onSuccess: refresh,
  });
  const dirty = title !== lb.title || blurb !== (lb.blurb ?? '') || short !== (lb.short_slug ?? '');
  const resetSave = save.reset;
  const reset = useCallback(() => {
    setTitle(lb.title);
    setBlurb(lb.blurb ?? '');
    setShort(lb.short_slug ?? '');
    resetSave();
  }, [lb.title, lb.blurb, lb.short_slug, resetSave]);
  return (
    <GuardedPanel
      id="details"
      title="Title and description"
      summary={[
        { key: 'Title', value: lb.title },
        { key: 'Description', value: lb.blurb ?? 'None' },
        { key: 'Short address', value: lb.short_slug ? `/${lb.short_slug}` : 'None' },
      ]}
      dirty={dirty}
      onSave={() => save.mutateAsync()}
      onCancel={reset}
    >
      <p className="muted">
        Neither is part of the questions, so both can change at any time. The web address /file/
        {lb.slug} cannot, but the short address below can.
      </p>
      <div className="form-stack">
        <Field label="Title">
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
          label="Short web address (optional)"
          help={`The form also opens at /${short.trim() || '…'}. Lowercase letters, numbers and hyphens. The long address keeps working.`}
        >
          {(p) => (
            <TextInput
              {...p}
              value={short}
              maxLength={63}
              onChange={(e) => {
                setShort(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Description (optional)">
          {(p) => (
            <TextArea
              {...p}
              value={blurb}
              onChange={(e) => {
                setBlurb(e.target.value);
              }}
            />
          )}
        </Field>
        <Problem error={save.error} />
      </div>
    </GuardedPanel>
  );
}

/**
 * WHETHER REPORTERS MAY ATTACH A NOTE OR LINK (N1). The attached note and
 * link questions are the only free text a logbook may ask, and they are never
 * published. Off, they are not asked at all and do not call for an email
 * address. A setting and not a question, so it can change after launch; off
 * for every logbook until an operator turns it on (D21).
 */
function NotesRule({ lb, refresh }: { lb: LogbookDetail; refresh: () => Promise<void> }) {
  const [on, setOn] = useState(lb.accepts_notes);
  const save = useMutation({
    mutationFn: () => call(updateLogbook, { params: { id: lb.id }, body: { accepts_notes: on } }),
    onSuccess: refresh,
  });
  const resetSave = save.reset;
  const reset = useCallback(() => {
    setOn(lb.accepts_notes);
    resetSave();
  }, [lb.accepts_notes, resetSave]);
  const asks = lb.fields.some((f) => f.kind === 'private_text' || f.kind === 'private_link');
  return (
    <GuardedPanel
      id="notes"
      title="Notes and links from reporters"
      summary={[
        { key: 'Reporters may attach a note or link', value: lb.accepts_notes ? 'Yes' : 'No' },
      ]}
      dirty={on !== lb.accepts_notes}
      onSave={() => save.mutateAsync()}
      onCancel={reset}
    >
      <p className="muted">
        {lb.accepts_notes
          ? 'Reporters are asked this logbook’s attached note and link questions. What they write is never published. A reporter who writes something is asked for an email address, so they can correct or erase it.'
          : 'Reporters are not asked for a note or a link, and nothing they type reaches this logbook. Its attached note and link questions, if it has any, are skipped.'}
      </p>
      <Check
        label="Reporters may attach a note or link"
        checked={on}
        help={
          asks
            ? 'Turn it on to ask this logbook’s attached note and link questions. It can be changed at any time, even after launch.'
            : 'This logbook has no attached note or link question yet. Add one under Questions, then turn this on.'
        }
        onCheckedChange={setOn}
      />
      <Problem error={save.error} />
    </GuardedPanel>
  );
}

type EmailChoice = 'never' | 'optional' | 'always';

/**
 * WHETHER THE FORM ASKS FOR AN EMAIL (owner decision E1, D8/D20). Derived from
 * the questions: one somebody types into, or files, and it asks. The operator
 * can only add the address to a form that would not ask (required, or an
 * optional card that can be skipped); never take it away from one that must.
 * Not part of the questions, so it can change after launch.
 */
function EmailRule({ lb, refresh }: { lb: LogbookDetail; refresh: () => Promise<void> }) {
  const fromQuestions = lb.asks_email && !lb.email_required;
  const saved: EmailChoice = lb.email_required
    ? 'always'
    : lb.email_optional
      ? 'optional'
      : 'never';
  const [choice, setChoice] = useState<EmailChoice>(saved);
  const save = useMutation({
    mutationFn: () =>
      call(updateLogbook, {
        params: { id: lb.id },
        body: { email_required: choice === 'always', email_optional: choice === 'optional' },
      }),
    onSuccess: refresh,
  });
  const resetSave = save.reset;
  const reset = useCallback(() => {
    setChoice(saved);
    resetSave();
  }, [saved, resetSave]);
  const words: Record<EmailChoice, string> = {
    never: 'Never',
    optional: 'Optional, can be skipped',
    always: 'Always',
  };
  return (
    <GuardedPanel
      id="email"
      title="Asking for an email address"
      summary={[
        { key: 'Asks', value: fromQuestions ? 'Always (its questions need it)' : words[saved] },
      ]}
      dirty={choice !== saved}
      onSave={() => save.mutateAsync()}
      onCancel={reset}
    >
      <p className="muted">
        {lb.asks_email
          ? 'This form asks every reporter for an email address. Nothing is filed until they confirm it from the link we send, and they can sign in later to correct or withdraw their report.'
          : 'This form does not ask for an email address. Each report is filed the moment it is sent, with no link to confirm, and the reporter cannot come back to correct or withdraw it.'}
      </p>
      {fromQuestions ? (
        <p className="muted">
          It asks because a question lets people type, or takes files. That cannot be switched off.
        </p>
      ) : (
        <RadioGroup
          aria-label="Asking for an email address"
          value={choice}
          onValueChange={(v) => {
            setChoice(v as EmailChoice);
          }}
        >
          <RadioOption
            value="never"
            label="Never"
            hint="For a form of choices only. Reports are filed on arrival."
          />
          <RadioOption
            value="optional"
            label="Optional, can be skipped"
            hint="An email card at the end. Left blank, the report is filed on arrival; with an address, it is held until the reporter follows the link."
          />
          <RadioOption
            value="always"
            label="Always"
            hint="Every reporter gives an address and confirms it from the link we send."
          />
        </RadioGroup>
      )}
      <Problem error={save.error} />
    </GuardedPanel>
  );
}

/**
 * Whether reporters are asked if their report may be published, or told that
 * filing here means it may be. Not part of the questions and never sealed
 * itself (each report seals the wording its reporter saw), so it can change
 * after launch.
 */
function PublicationRule({ lb, refresh }: { lb: LogbookDetail; refresh: () => Promise<void> }) {
  const [on, setOn] = useState(lb.publish_by_terms);
  const save = useMutation({
    mutationFn: () =>
      call(updateLogbook, { params: { id: lb.id }, body: { publish_by_terms: on } }),
    onSuccess: refresh,
  });
  const resetSave = save.reset;
  const reset = useCallback(() => {
    setOn(lb.publish_by_terms);
    resetSave();
  }, [lb.publish_by_terms, resetSave]);
  return (
    <GuardedPanel
      id="publishing"
      title="Publishing"
      summary={[
        {
          key: 'Rule',
          value: lb.publish_by_terms
            ? 'Publishing is a condition of filing'
            : 'Reporters are asked',
        },
      ]}
      dirty={on !== lb.publish_by_terms}
      onSave={() => save.mutateAsync()}
      onCancel={reset}
    >
      <p className="muted">
        {lb.publish_by_terms
          ? 'Reporters are not asked whether their report may be published. The last card tells them that filing here means it may be, once a moderator approves it.'
          : 'Reporters are asked whether their report may be published. A report whose reporter says no, or does not answer, is never published.'}
      </p>
      <Check
        label="Publishing is a condition of filing"
        checked={on}
        help="For a logbook that exists to be public and asks for nothing personal. Each report records which of the two it was filed under."
        onCheckedChange={setOn}
      />
      <Problem error={save.error} />
    </GuardedPanel>
  );
}

/**
 * Whether the front page advertises this logbook while it is open. Only
 * advertising: it opens nothing and closes nothing, and it is never sealed, so
 * it can change after launch. Off, the logbook is left off the front page even
 * if the page's buttons name it (Logbooks, The front page's buttons).
 */
function FrontPageSwitch({ lb, refresh }: { lb: LogbookDetail; refresh: () => Promise<void> }) {
  const [on, setOn] = useState(lb.show_on_front);
  const save = useMutation({
    mutationFn: () => call(updateLogbook, { params: { id: lb.id }, body: { show_on_front: on } }),
    onSuccess: refresh,
  });
  const resetSave = save.reset;
  const reset = useCallback(() => {
    setOn(lb.show_on_front);
    resetSave();
  }, [lb.show_on_front, resetSave]);
  return (
    <GuardedPanel
      id="front"
      title="On the front page"
      summary={[{ key: 'Btn', value: lb.show_on_front ? 'Shown while open' : 'Not shown' }]}
      dirty={on !== lb.show_on_front}
      onSave={() => save.mutateAsync()}
      onCancel={reset}
    >
      <Check
        label="Show on the front page"
        checked={on}
        help="While it is open, it is a button on the front page, added at the end if the page’s buttons do not place it. Off, it is not shown there, whatever the buttons say."
        onCheckedChange={setOn}
      />
      <Problem error={save.error} />
    </GuardedPanel>
  );
}

function QuestionList({ lb, refresh }: { lb: LogbookDetail; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const launched = lb.state !== 'draft';
  const params = { id: lb.id };

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e : new Error('That did not work.'));
    }
  };

  // Reordering sends the WHOLE order, so a half-applied move cannot be left.
  const move = (index: number, by: -1 | 1) =>
    run(() => {
      const ids = lb.fields.map((f) => f.id);
      const [moved] = ids.splice(index, 1);
      if (moved === undefined) return Promise.resolve();
      ids.splice(index + by, 0, moved);
      return call(reorderQuestions, { params, body: { ids } });
    });

  if (!lb.fields.length) {
    return (
      <p className="muted">
        No questions yet. A report is a logbook’s answers, so add at least one before launching.
      </p>
    );
  }

  return (
    <>
      <Problem error={error} />
      <div className="qlist" role="list" aria-label="The questions, in order">
        {lb.fields.map((q, i) =>
          editing === q.id && launched ? (
            <RewordForm
              key={q.id}
              question={q}
              earlier={defs(lb.fields.slice(0, i))}
              onCancel={() => {
                setEditing(null);
              }}
              onSubmit={async (body) => {
                await call(updateQuestion, { params: { id: lb.id, fieldId: q.id }, body });
                setEditing(null);
                await refresh();
              }}
            />
          ) : editing === q.id ? (
            <QuestionForm
              key={q.id}
              earlier={lb.fields.slice(0, i)}
              launched={launched}
              initial={q}
              submitLabel="Save the question"
              onCancel={() => {
                setEditing(null);
              }}
              onSubmit={async (body) => {
                await call(updateQuestion, { params: { id: lb.id, fieldId: q.id }, body });
                setEditing(null);
                await refresh();
              }}
            />
          ) : (
            <div key={q.id} className="qitem" role="listitem">
              <span className="h" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <b>{q.label}</b>
                <small>
                  {[
                    fieldType(q.kind)?.label ?? q.kind,
                    q.required ? 'Needed' : null,
                    q.filterable ? 'Filter' : null,
                    q.shown_when ? 'Sometimes' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
                {isPublishedFreeText(q) && (
                  <Note tone="warning">
                    This question is published as typed and cannot be changed.
                  </Note>
                )}
                {q.help && <small>{q.help}</small>}
                {q.shown_when && <small>{describeCondition(q.shown_when, defs(lb.fields))}</small>}
                {typeof q.settings.card_question === 'string' && (
                  <small>Its card asks “{q.settings.card_question}”.</small>
                )}
                {q.settings.same_card === true && (
                  <small>Asked on the same card as the question above it.</small>
                )}
                {Array.isArray(q.settings.option_sets) && (
                  <small>
                    Which choices it offers depends on an earlier answer (
                    {String(q.settings.option_sets.length)} lists).
                  </small>
                )}
                <small>
                  {q.required ? 'Needs an answer' : 'Optional'} · answered under{' '}
                  <span className="mono">{q.key}</span>
                </small>
              </div>
              <div className="acts">
                {!launched && (
                  <>
                    <Btn look="ghost" sm flat
                      
                      disabled={i === 0}
                      aria-label={`Move up: “${q.label}”`}
                      onClick={() => void move(i, -1)}
                    >
                      ↑
                    </Btn>
                    <Btn look="ghost" sm flat
                      
                      disabled={i === lb.fields.length - 1}
                      aria-label={`Move down: “${q.label}”`}
                      onClick={() => void move(i, 1)}
                    >
                      ↓
                    </Btn>
                    <Btn sm flat
                      
                      aria-label={`Change “${q.label}”`}
                      onClick={() => {
                        setEditing(q.id);
                      }}
                    >
                      Change
                    </Btn>
                    <Btn look="ghost" sm flat
                      
                      aria-label={`Remove “${q.label}”`}
                      onClick={() =>
                        void run(() =>
                          call(removeQuestion, { params: { id: lb.id, fieldId: q.id } }),
                        )
                      }
                    >
                      Remove
                    </Btn>
                  </>
                )}
                {launched && (
                  <Btn sm flat
                    
                    aria-label={`Reword “${q.label}”`}
                    onClick={() => {
                      setEditing(q.id);
                    }}
                  >
                    Reword
                  </Btn>
                )}
                {launched && canFilter(q.kind) && (
                  <Check
                    label="A filter on the board"
                    checked={q.filterable}
                    onCheckedChange={(on) =>
                      void run(() =>
                        call(updateQuestion, {
                          params: { id: lb.id, fieldId: q.id },
                          body: { filterable: on },
                        }),
                      )
                    }
                  />
                )}
              </div>
            </div>
          ),
        )}
      </div>
    </>
  );
}

function Launch({ lb, refresh }: { lb: LogbookDetail; refresh: () => Promise<void> }) {
  return (
    <Panel title="Launch">
      {lb.fields.length === 0 ? (
        <p className="muted">Add at least one question before launching.</p>
      ) : (
        <TypeToConfirm
          title={lb.title}
          action="Launch this logbook"
          primary
          onConfirm={async () => {
            await call(launchLogbook, { params: { id: lb.id } });
            await refresh();
          }}
        >
          <p>
            Launching opens this logbook to reporters and fixes its questions for good. Afterwards
            it can gain a new optional question and nothing else: no rewording, removing,
            reordering, or making a question compulsory.
          </p>
          <p>There is no way to undo a launch. Closing a logbook later is reversible.</p>
        </TypeToConfirm>
      )}
    </Panel>
  );
}

function Lifecycle({ lb, refresh }: { lb: LogbookDetail; refresh: () => Promise<void> }) {
  const params = { id: lb.id };
  const [opens, setOpens] = useState(toLocalInput(lb.opens_at));
  const [closes, setCloses] = useState(toLocalInput(lb.closes_at));
  const closed = useMutation({
    mutationFn: (value: boolean) => call(setLogbookClosed, { params, body: { closed: value } }),
    onSuccess: refresh,
  });
  const schedule = useMutation({
    mutationFn: () =>
      call(setLogbookSchedule, {
        params,
        body: { opens_at: fromLocalInput(opens), closes_at: fromLocalInput(closes) },
      }),
    onSuccess: refresh,
  });
  const isClosed = lb.closed_at !== null;

  return (
    <Panel title="Taking reports">
      <Dl
        items={[
          { key: 'Now', value: isClosed ? 'Closed' : stateLabel[lb.state] },
          { key: 'Opens', value: lb.opens_at ? day(lb.opens_at) : 'When it launched' },
          { key: 'Closes', value: lb.closes_at ? day(lb.closes_at) : 'No end set' },
        ]}
      />
      <p className="muted">
        Closing stops new reports and keeps every report already filed. It can be undone.
      </p>
      <Problem error={closed.error} />
      <Btn sm flat
        
        disabled={closed.isPending}
        onClick={() => {
          closed.mutate(!isClosed);
        }}
      >
        {isClosed ? 'Reopen this logbook' : 'Close this logbook'}
      </Btn>

      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          schedule.mutate();
        }}
      >
        <h3>Opening and closing times</h3>
        <Field label="Opens (leave empty to open now)">
          {(p) => (
            <TextInput
              {...p}
              type="datetime-local"
              value={opens}
              onChange={(e) => {
                setOpens(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Closes (leave empty for no end)">
          {(p) => (
            <TextInput
              {...p}
              type="datetime-local"
              value={closes}
              onChange={(e) => {
                setCloses(e.target.value);
              }}
            />
          )}
        </Field>
        <Problem error={schedule.error} />
        <Btn sm flat type="submit"  disabled={schedule.isPending}>
          Save the opening times
        </Btn>
      </form>
    </Panel>
  );
}

function DeleteDraft({ lb }: { lb: LogbookDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <Panel title="Delete this draft">
      <TypeToConfirm
        title={lb.title}
        action="Delete this draft"
        onConfirm={async () => {
          await call(deleteLogbook, { params: { id: lb.id } });
          await qc.invalidateQueries({ queryKey: logbooksQuery().queryKey });
          await navigate({ to: '/logbooks' });
        }}
      >
        <p>
          A draft has never taken a report, so deleting it removes nothing anybody filed. Once a
          logbook launches it can never be deleted, only closed.
        </p>
      </TypeToConfirm>
    </Panel>
  );
}
