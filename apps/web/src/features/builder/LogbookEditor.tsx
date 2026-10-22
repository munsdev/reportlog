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
import { canFilter, describeCondition, fieldType } from '@reportlog/fields';
import type { FieldDefinition } from '@reportlog/fields';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, buttonVariants } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { Chip } from '../../components/ui/chip.tsx';
import { KeyValueList } from '../../components/ui/key-value-list.tsx';
import { StepUpDownload } from '../identity/StepUp.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
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
      <div role="alert" className="space-y-2">
        <p className="font-semibold">{query.error.message}</p>
        <Link to="/logbooks" className="underline">
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
    <StaffPage
      eyebrow={`Logbook · ${stateLabel[lb.state]}`}
      title={lb.title}
      lede={stateWords(lb)}
      actions={<Downloads lb={lb} />}
    >
      <div className="flex flex-col gap-3">
        <p>
          <Link to="/logbooks" className="text-sm underline">
            ← All logbooks
          </Link>
        </p>
        <p className="flex flex-wrap items-center gap-2">
          <Chip tone="tag">{stateLabel[lb.state]}</Chip>
          {lb.asks_for_files ? <Chip tone="tag">Takes files</Chip> : null}
          <span data-filing-address className="font-mono text-sm break-all text-muted">
            /file/{lb.slug}
          </span>
        </p>
        {launched ? (
          // Only a launched logbook has a form a reporter can open; a draft's
          // is not served to anybody, so the button is left out until then.
          <p>
            <a
              href={`/file/${lb.slug}`}
              target="_blank"
              rel="noopener"
              className={buttonVariants({ variant: 'secondary' })}
            >
              Open the reporter’s form (new tab)
            </a>
          </p>
        ) : null}
      </div>

      <Details lb={lb} refresh={refresh} />
      <EmailRule lb={lb} refresh={refresh} />
      <PublicationRule lb={lb} refresh={refresh} />

      <Panel title="Questions">
        {launched && (
          <Card variant="quiet">
            <p>
              {lb.launched_at ? `Launched on ${day(lb.launched_at)}. ` : ''}The questions’ keys,
              kinds, order, conditions and codes are frozen, so every sealed report still checks.
              You can reword a label or help, add an optional question at the end, and choose which
              questions the board offers as filters.
            </p>
          </Card>
        )}
        <QuestionList lb={lb} refresh={refresh} />
        <Card variant="quiet" heading="Add a question" headingLevel={3}>
          <QuestionForm
            earlier={lb.fields}
            launched={launched}
            submitLabel="Add the question"
            onSubmit={async (body: QuestionBody, kind: string) => {
              await call(addQuestion, { params, body: { ...body, kind } });
              await refresh();
            }}
          />
        </Card>
      </Panel>

      {launched && <Lifecycle lb={lb} refresh={refresh} />}
      <OutsidePanel lb={lb} refresh={refresh} />
      <FreezePanel lb={lb} refresh={refresh} />

      {!launched && <Launch lb={lb} refresh={refresh} />}
      {!launched && <DeleteDraft lb={lb} />}
    </StaffPage>
  );
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * "As a file", beside the title: the logbook file (its title and
 * questions, to keep or to start another from), and, once it has launched,
 * its complete chain, which asks for the step-up first (plan E, E3).
 */
function Downloads({ lb }: { lb: LogbookDetail }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="label-face text-xs text-ink-alt">As a file</span>
      <div className="flex flex-wrap gap-2">
        <a
          href={`/api/admin/logbooks/${String(lb.id)}/file`}
          download={`logbook-${lb.slug}.json`}
          className={buttonVariants({ variant: 'secondary' })}
        >
          The logbook file
        </a>
        {lb.state !== 'draft' ? (
          <StepUpDownload
            href={getCompleteChainFile.path.replace(':slug', encodeURIComponent(lb.slug))}
            className={buttonVariants({ variant: 'secondary' })}
          >
            Its chain
          </StepUpDownload>
        ) : null}
      </div>
    </div>
  );
}

function Details({ lb, refresh }: { lb: LogbookDetail; refresh: () => Promise<void> }) {
  const [title, setTitle] = useState(lb.title);
  const [blurb, setBlurb] = useState(lb.blurb ?? '');
  const save = useMutation({
    mutationFn: () => call(updateLogbook, { params: { id: lb.id }, body: { title, blurb } }),
    onSuccess: refresh,
  });
  return (
    <Panel title="Title and description">
      <p className="text-sm text-muted">
        Neither is part of the questions, so both can change at any time. The web address cannot.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
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
        <Button type="submit" variant="secondary" disabled={save.isPending}>
          Save the title and description
        </Button>
        {save.isSuccess && <p role="status">Saved.</p>}
      </form>
    </Panel>
  );
}

/**
 * WHETHER THE FORM ASKS FOR AN EMAIL (owner decision E1). Derived from the
 * questions: one somebody types into, or files, and it asks. The operator can
 * only add the address to a form that would not ask; never take it away from
 * one that must. Not part of the questions, so it can change after launch.
 */
function EmailRule({ lb, refresh }: { lb: LogbookDetail; refresh: () => Promise<void> }) {
  const save = useMutation({
    mutationFn: (on: boolean) =>
      call(updateLogbook, { params: { id: lb.id }, body: { email_required: on } }),
    onSuccess: refresh,
  });
  const fromQuestions = lb.asks_email && !lb.email_required;
  return (
    <Panel title="Asking for an email address">
      <p className="text-sm text-muted">
        {lb.asks_email
          ? 'This form asks every reporter for an email address. Nothing is filed until they confirm it from the link we send, and they can sign in later to correct or withdraw their report.'
          : 'This form does not ask for an email address. Each report is filed the moment it is sent, with no link to confirm, and the reporter cannot come back to correct or withdraw it.'}
      </p>
      {fromQuestions ? (
        <p className="text-sm text-muted">
          It asks because a question lets people type, or takes files. That cannot be switched off.
        </p>
      ) : (
        <Check
          label="Ask for an email address anyway"
          checked={lb.email_required}
          disabled={save.isPending}
          help="For a form of choices only, where you still want to reach reporters."
          onCheckedChange={(on) => {
            save.mutate(on);
          }}
        />
      )}
      <Problem error={save.error} />
    </Panel>
  );
}

/**
 * Whether reporters are asked if their report may be published, or told that
 * filing here means it may be. Not part of the questions and never sealed
 * itself (each report seals the wording its reporter saw), so it can change
 * after launch.
 */
function PublicationRule({ lb, refresh }: { lb: LogbookDetail; refresh: () => Promise<void> }) {
  const save = useMutation({
    mutationFn: (on: boolean) =>
      call(updateLogbook, { params: { id: lb.id }, body: { publish_by_terms: on } }),
    onSuccess: refresh,
  });
  return (
    <Panel title="Publishing">
      <p className="text-sm text-muted">
        {lb.publish_by_terms
          ? 'Reporters are not asked whether their report may be published. The last card tells them that filing here means it may be, once a moderator approves it.'
          : 'Reporters are asked whether their report may be published. A report whose reporter says no, or does not answer, is never published.'}
      </p>
      <Check
        label="Publishing is a condition of filing"
        checked={lb.publish_by_terms}
        disabled={save.isPending}
        help="For a logbook that exists to be public and asks for nothing personal. Each report records which of the two it was filed under."
        onCheckedChange={(on) => {
          save.mutate(on);
        }}
      />
      <Problem error={save.error} />
    </Panel>
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
      <p className="text-ink-alt">
        No questions yet. A report is a logbook’s answers, so add at least one before launching.
      </p>
    );
  }

  return (
    <>
      <Problem error={error} />
      <ol className="space-y-3" aria-label="The questions, in order">
        {lb.fields.map((q, i) => (
          <li
            key={q.id}
            className="flex flex-col gap-2 rounded-card border-(length:--rl-border-main) border-ink-alt bg-surface p-4 shadow-raised"
          >
            {editing === q.id && launched ? (
              <RewordForm
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
              <>
                <p className="font-display text-lg font-bold">
                  {i + 1}. {q.label}
                </p>
                <p className="flex flex-wrap items-center gap-2">
                  <Chip tone="tag" className="font-mono">
                    {fieldType(q.kind)?.label ?? q.kind}
                  </Chip>
                  {q.required ? <Chip tone="tag">Needed</Chip> : null}
                  {q.filterable ? <Chip tone="tag">Filter</Chip> : null}
                  {q.shown_when ? <Chip tone="tag">Sometimes</Chip> : null}
                </p>
                {q.help && <p className="text-sm text-ink-alt">{q.help}</p>}
                {q.shown_when && (
                  <p className="text-sm">{describeCondition(q.shown_when, defs(lb.fields))}</p>
                )}
                {typeof q.settings.card_question === 'string' && (
                  <p className="text-sm">Its card asks “{q.settings.card_question}”.</p>
                )}
                {q.settings.same_card === true && (
                  <p className="text-sm">Asked on the same card as the question above it.</p>
                )}
                {Array.isArray(q.settings.option_sets) && (
                  <p className="text-sm">
                    Which choices it offers depends on an earlier answer (
                    {String(q.settings.option_sets.length)} lists).
                  </p>
                )}
                <p className="text-sm text-ink-alt">
                  {q.required ? 'Needs an answer' : 'Optional'} · answered under{' '}
                  <span className="font-mono text-ink">{q.key}</span>
                </p>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  {!launched && (
                    <>
                      <Button
                        variant="secondary"
                        disabled={i === 0}
                        aria-label={`Move up: “${q.label}”`}
                        onClick={() => void move(i, -1)}
                      >
                        Move up
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={i === lb.fields.length - 1}
                        aria-label={`Move down: “${q.label}”`}
                        onClick={() => void move(i, 1)}
                      >
                        Move down
                      </Button>
                      <Button
                        variant="secondary"
                        aria-label={`Change “${q.label}”`}
                        onClick={() => {
                          setEditing(q.id);
                        }}
                      >
                        Change
                      </Button>
                      <Button
                        variant="secondary"
                        aria-label={`Remove “${q.label}”`}
                        onClick={() =>
                          void run(() =>
                            call(removeQuestion, { params: { id: lb.id, fieldId: q.id } }),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </>
                  )}
                  {launched && (
                    <Button
                      variant="secondary"
                      aria-label={`Reword “${q.label}”`}
                      onClick={() => {
                        setEditing(q.id);
                      }}
                    >
                      Reword
                    </Button>
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
              </>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

function Launch({ lb, refresh }: { lb: LogbookDetail; refresh: () => Promise<void> }) {
  return (
    <Panel title="Launch">
      {lb.fields.length === 0 ? (
        <p className="text-ink-alt">Add at least one question before launching.</p>
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
      <KeyValueList
        items={[
          { key: 'Now', value: isClosed ? 'Closed' : stateLabel[lb.state] },
          { key: 'Opens', value: lb.opens_at ? day(lb.opens_at) : 'When it launched' },
          { key: 'Closes', value: lb.closes_at ? day(lb.closes_at) : 'No end set' },
        ]}
      />
      <p className="text-ink-alt">
        Closing stops new reports and keeps every report already filed. It can be undone.
      </p>
      <Problem error={closed.error} />
      <Button
        variant="secondary"
        disabled={closed.isPending}
        onClick={() => {
          closed.mutate(!isClosed);
        }}
      >
        {isClosed ? 'Reopen this logbook' : 'Close this logbook'}
      </Button>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          schedule.mutate();
        }}
      >
        <h3 className="font-display text-lg font-bold">Opening and closing times</h3>
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
        <Button type="submit" variant="secondary" disabled={schedule.isPending}>
          Save the opening times
        </Button>
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
