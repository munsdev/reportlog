/**
 * First-run setup: who owns this deployment, what it is called, what kind of
 * archive it is, whether it publishes, whether it takes files, how it looks,
 * and last the site password.
 *
 * The owner proves their address with a code, which also proves mail works
 * here. The five screens after it have no routes of their own: each saves
 * through the route its own settings screen uses, as the owner, who holds an
 * administrator's authority. A second route onto one setting would be a
 * second place for it to be wrong. Each screen saves before moving on, so a
 * tab closed halfway keeps the answers already given, Back shows what was
 * saved rather than what was typed, and a screen that cannot save does not
 * move on (carrying on would hand somebody a deployment set up the way they
 * did not choose, with the wizard saying it had asked).
 *
 * The last screen, the curtain password, cannot be skipped: the password the
 * installer chose would otherwise stay live in a deployment that is no
 * longer theirs. It is also the only screen that ends setup.
 *
 * Choosing an option highlights it and moves nothing; the button does. A
 * screen is drawn only once what it shows has loaded, so a preselected answer
 * never jumps under somebody's cursor.
 *
 * THE LOOK OF IT (settings-and-admin.md §07): one question a screen, every
 * choice a choice card, a progress rule under "Step 3 of 7", "Use this and
 * continue" as the one primary button, full width on a phone. The name step
 * shows the Name screen's header picture; the look step is the Look screen's
 * named looks and its two preview frames, with the name just given.
 */
import {
  DEFAULT_LOOK,
  PREVIOUS_DEFAULT_LOOK,
  MAX_SITE_NAME,
  accentMarksClose,
  applyTemplate,
  decideCurtain,
  getArchiveSwitch,
  getFileSettings,
  getSiteEditor,
  listTemplates,
  parseBrand,
  plainName,
  setArchiveSwitch,
  setFileSettings,
  setLook,
  setSiteName,
} from '@reportlog/contracts';
import type { Look } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useId, useState } from 'react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { applyLook } from '@/components/ui/site.tsx';
import { call } from '../../lib/api.ts';
import { LookChooser } from '../settings/LookChooser.tsx';
import { LookFrames } from '../settings/LookPreview.tsx';
import { NamePreview } from '../settings/NamePreview.tsx';
import { lookName } from '../settings/looks.ts';
import { meQuery } from './session.ts';
import { SecondFactorGate } from './secondFactor.tsx';
import { SignInForm } from './SignInForm.tsx';
import { Field } from '../../mockup/Qcard.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { messageOf } from './ui.tsx';

/** The screens, in order. The first cannot be gone back to: the server refuses it once it is done. */
export const SETUP_STEPS = [
  'owner',
  'name',
  'start',
  'publication',
  'files',
  'look',
  'password',
] as const;
type Step = (typeof SETUP_STEPS)[number];

const TITLES: Record<Step, string> = {
  owner: 'Who will own this deployment?',
  name: 'What is this archive called?',
  start: 'What kind of archive is this?',
  publication: 'Does this deployment publish an archive?',
  files: 'Can people attach files to a report?',
  look: 'How should it look?',
  password: 'The site password',
};

// The wizard's own keys, so nothing it reads is mistaken for a settings
// screen's cache (or the other way round) after setup ends.
const keys = {
  editor: ['setup', 'site-editor'],
  templates: ['setup', 'templates'],
  archive: ['setup', 'archive'],
  files: ['setup', 'files'],
} as const;

export function SetupWizard({
  status,
  onFinished,
}: {
  status: { hasOwner: boolean; minPassword: number };
  onFinished: () => Promise<void>;
}) {
  const me = useQuery(meQuery);
  const [seated, setSeated] = useState(false);
  const isOwner = seated || (me.data?.signedIn === true && me.data.roles.includes('owner'));
  // A reloaded tab with an owner already seated resumes at the first screen
  // that can still be answered, not at one the server now refuses.
  const [at, setAt] = useState<Exclude<Step, 'owner'>>('name');
  const step: Step = isOwner ? at : 'owner';
  const n = SETUP_STEPS.indexOf(step);
  const go = (to: number) => {
    const next = SETUP_STEPS[to];
    if (next && next !== 'owner') setAt(next);
  };
  const next = () => {
    go(n + 1);
  };
  const back =
    n > 1
      ? () => {
          go(n - 1);
        }
      : undefined;

  useBodyClass('light', 'form');
  // The Look screen shows two preview frames side by side, so it runs wider.
  return (
    <main id="main">
      <div
        className="wrap"
        style={{
          paddingTop: 30,
          maxWidth: step === 'look' ? undefined : 640,
          display: 'grid',
          gap: 18,
        }}
      >
        <span className="step">
          Setting up · step {n + 1} of {SETUP_STEPS.length}
        </span>
        <Progress at={n + 1} of={SETUP_STEPS.length} />
        <h1 className="h-page" id="h1">
          {TITLES[step]}
        </h1>
        {/* The owner, once seated, sets up a second factor before the rest
          (plan E, E3): the server lets the seat do nothing until then. */}
        <SecondFactorGate>
          {step === 'owner' &&
            (status.hasOwner ? (
              <section style={formStyle}>
                <p>
                  This deployment already has an owner, who has not finished setting it up. Sign in
                  as the owner to finish.
                </p>
                <SignInForm
                  onSignedIn={async () => {
                    await me.refetch();
                  }}
                />
              </section>
            ) : (
              <SignInForm
                purpose="setup"
                intro="The owner is the one person who appoints administrators and can hand the deployment on. We will email a code to prove the address is yours, and that email works here."
                onSignedIn={async () => {
                  setSeated(true);
                  await me.refetch();
                }}
              />
            ))}
          {step === 'name' && <NameStep onDone={next} back={back} />}
          {step === 'start' && <StartStep onDone={next} back={back} />}
          {step === 'publication' && <PublicationStep onDone={next} back={back} />}
          {step === 'files' && <FilesStep onDone={next} back={back} />}
          {step === 'look' && <LookStep onDone={next} back={back} />}
          {step === 'password' && (
            <CurtainDecision minPassword={status.minPassword} onFinished={onFinished} back={back} />
          )}
        </SecondFactorGate>
      </div>
    </main>
  );
}

/**
 * How far through setup this is, as a rule that fills: the same shape as a
 * filing card's progress. The line above it says the same in words, so the
 * bar is hidden from screen readers rather than read twice.
 */
function Progress({ at, of }: { at: number; of: number }) {
  return (
    <div className="progress" aria-hidden="true">
      <span style={{ width: `${String(Math.round((at / of) * 100))}%` }} />
    </div>
  );
}

/** What a step's form is laid out with: the mock-up's grid, one gap a row. */
const formStyle: CSSProperties = { display: 'grid', gap: 18 };

interface StepProps {
  onDone: () => void;
  back: (() => void) | undefined;
}

/** A screen's buttons: the one that saves and moves on, then Back (if there is one). */
function Actions({
  back,
  pending,
  label = 'Use this and continue',
  disabled = false,
  children,
}: {
  back: (() => void) | undefined;
  pending: boolean;
  label?: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="btn-row">
      <button className="btn sm flat go" type="submit" disabled={disabled || pending}>
        {pending ? 'Saving…' : label}
      </button>
      {children}
      {back && (
        <button className="btn sm flat ghost" type="button" onClick={back} disabled={pending}>
          Back
        </button>
      )}
    </div>
  );
}

/** A group of choice cards (mock-up .choices); choosing highlights and moves nothing. */
const GroupContext = createContext<{
  name: string;
  value: string;
  set: (v: string) => void;
} | null>(null);

function Choices({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  const name = useId();
  return (
    <GroupContext.Provider value={{ name, value, set: onChange }}>
      <div className="choices" role="radiogroup" aria-label={label}>
        {children}
      </div>
    </GroupContext.Provider>
  );
}

function Choice({
  value,
  title,
  children,
}: {
  value: string;
  title: string;
  children?: ReactNode;
}) {
  const group = useContext(GroupContext);
  return (
    <label className="choice">
      <input
        type="radio"
        name={group?.name ?? ''}
        checked={group?.value === value}
        onChange={() => {
          group?.set(value);
        }}
      />
      <span className="dot" aria-hidden="true" />
      <span>
        {title}
        {children ? (
          <span className="muted" style={{ display: 'block', fontWeight: 400, fontSize: '.9rem' }}>
            {children}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function Loading() {
  return (
    <p role="status" className="muted">
      Loading
    </p>
  );
}

/** A labelled text box (mock-up .field). */
function Text({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & ComponentProps<'input'>) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} help={hint}>
      <input className="input" id={id} {...input} />
    </Field>
  );
}

/** A sentence saying what is wrong. */
function Problem({ error, children }: { error?: unknown; children?: ReactNode }) {
  if (!error && !children) return null;
  return (
    <p role="alert" className="error">
      {children ?? messageOf(error)}
    </p>
  );
}

/* ---- the name ------------------------------------------------------- */

/**
 * REQUIRED HERE, and only here. Legacy offered "leave blank to use ReportLog",
 * so the easiest thing was nothing and a deployment went live named after the
 * software. The name screen under Settings still takes an empty box to mean
 * the software's name; the wizard is the one moment a deployment has none.
 */
export function nameProblem(raw: string): string | null {
  const name = raw.trim();
  if (!plainName(name).trim()) return 'Give this archive a name.';
  if (plainName(name).length > MAX_SITE_NAME) {
    return `Keep the name under ${String(MAX_SITE_NAME)} characters.`;
  }
  if (!accentMarksClose(name)) {
    return 'Close the quotes, or leave them out. A pair of double quotes marks part of the name in the accent colour.';
  }
  return null;
}

function NameStep({ onDone, back }: StepProps) {
  const editor = useQuery({
    queryKey: keys.editor,
    queryFn: ({ signal }) => call(getSiteEditor, { signal }),
  });
  if (editor.isPending) return <Loading />;
  // Not being able to read the stored name is no reason to stop a handover:
  // the box starts empty and the answer is saved as usual.
  return <NameForm stored={editor.data?.name ?? ''} onDone={onDone} back={back} />;
}

function NameForm({ stored, onDone, back }: StepProps & { stored: string }) {
  const client = useQueryClient();
  const [name, setName] = useState(stored);
  const [tried, setTried] = useState(false);
  const problem = nameProblem(name);
  const save = useMutation({
    mutationFn: () => call(setSiteName, { body: { name: name.trim() } }),
    onSuccess: (state) => {
      client.setQueryData(keys.editor, state);
      onDone();
    },
  });
  return (
    <form
      style={formStyle}
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (!problem) save.mutate();
      }}
    >
      <p>
        Shown on every page, in the browser tab and in the emails this deployment sends. The
        software is called ReportLog either way, and the footer keeps saying so.
      </p>
      <Text
        label="Its name"
        hint="Put part of it in double quotes to draw it in the accent colour, or in single quotes for a quieter second accent. The quotes themselves are never shown."
        value={name}
        autoComplete="off"
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <NamePreview name={name.trim() || 'ReportLog'} page={false} />
      {tried && problem ? <Problem>{problem}</Problem> : null}
      <Problem error={save.error} />
      <Actions back={back} pending={save.isPending} />
    </form>
  );
}

/* ---- the starting point -------------------------------------------- */

function StartStep({ onDone, back }: StepProps) {
  const client = useQueryClient();
  const catalogue = useQuery({
    queryKey: keys.templates,
    queryFn: ({ signal }) => call(listTemplates, { signal }),
  });
  const [picked, setPicked] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const apply = useMutation({
    mutationFn: (template: string) => call(applyTemplate, { body: { template } }),
    onSuccess: async () => {
      // The next screens show what it just set, so they ask afresh.
      await client.invalidateQueries({ queryKey: ['setup'] });
      onDone();
    },
  });
  if (catalogue.isPending) return <Loading />;
  const templates = catalogue.data?.templates ?? [];
  const applied = catalogue.data?.applied ?? null;
  const appliedLabel = templates.find((t) => t.id === applied?.id)?.label;

  return (
    <form
      style={formStyle}
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (picked) apply.mutate(picked);
      }}
    >
      <p>
        A starting point, and nothing more than that. It fills in the settings on the next screens,
        which ask you about each of them anyway, and it locks nothing: every one stays yours to
        change. Most also make a <strong>draft</strong> logbook, the questions a reporter answers.
        Nobody can file anything until you have read it and launched it yourself, under Logbooks.
      </p>
      {appliedLabel && (
        <p className="muted">
          You already started from “{appliedLabel}”. Choosing again adds another draft logbook and
          does not touch the first.
        </p>
      )}
      {templates.length === 0 ? (
        <p>
          No starting points could be loaded. Skip this and set everything up by hand: the next
          screens ask the same questions either way.
        </p>
      ) : (
        <Choices label="Starting points" value={picked ?? ''} onChange={setPicked}>
          {templates.map((t) => (
            <Choice key={t.id} value={t.id} title={t.label}>
              <span className="block">{t.description}</span>
              <span className="block">
                {t.sets.map((line) => (
                  <span key={line} className="block">
                    · {line}
                  </span>
                ))}
              </span>
            </Choice>
          ))}
        </Choices>
      )}
      {tried && !picked ? <Problem>Choose one, or skip this.</Problem> : null}
      <Problem error={apply.error} />
      <Actions back={back} pending={apply.isPending}>
        <button className="btn sm flat" type="button" onClick={onDone} disabled={apply.isPending}>
          Skip: I will set it up myself
        </button>
      </Actions>
    </form>
  );
}

/* ---- publishing ---------------------------------------------------- */

/**
 * Two switches asked as a choice, not a checkbox, because a checkbox cannot
 * tell "left alone" from "decided against". Each arrives at what the site
 * would do now and says which that is, unlike the password, where no default
 * is offered on purpose.
 */
function PublicationStep({ onDone, back }: StepProps) {
  const state = useQuery({
    queryKey: keys.archive,
    queryFn: ({ signal }) => call(getArchiveSwitch, { signal }),
  });
  if (state.isPending) return <Loading />;
  const now = state.data ? (state.data.published ? 'yes' : 'no') : null;
  return <YesNo key={now} kind="publication" now={now} onDone={onDone} back={back} />;
}

function FilesStep({ onDone, back }: StepProps) {
  const state = useQuery({
    queryKey: keys.files,
    queryFn: ({ signal }) => call(getFileSettings, { signal }),
  });
  if (state.isPending) return <Loading />;
  const s = state.data;
  // What was CHOSEN, not what storage allows today: a yes recorded before
  // storage exists starts working once it does.
  const now = s ? ((s.enabled_stored ?? s.enabled) ? 'yes' : 'no') : null;
  return (
    <YesNo
      key={now}
      kind="files"
      now={now}
      onDone={onDone}
      back={back}
      note={
        s && !s.configured
          ? `This deployment has nowhere to keep files yet${s.why_not ? ` (${s.why_not})` : ''}, so nothing can be attached whatever you answer. A yes records the decision; uploads start once storage is set up.`
          : null
      }
    />
  );
}

function YesNo({
  kind,
  now,
  note = null,
  onDone,
  back,
}: StepProps & { kind: 'publication' | 'files'; now: string | null; note?: string | null }) {
  const [chosen, setChosen] = useState<string | null>(now);
  const save = useMutation({
    mutationFn: async (yes: boolean) => {
      if (kind === 'publication') await call(setArchiveSwitch, { body: { published: yes } });
      else await call(setFileSettings, { body: { enabled: yes } });
    },
    onSuccess: onDone,
  });
  return (
    <form
      style={formStyle}
      onSubmit={(e) => {
        e.preventDefault();
        if (chosen) save.mutate(chosen === 'yes');
      }}
    >
      {kind === 'publication' ? (
        <>
          <p>
            This is the site’s own decision, separate from the reporter’s. A report is only ever
            public if its reporter allowed it, a moderator approved it, and this is on.
          </p>
          <p>
            Either way, reports go on being filed, confirmed and moderated, and nothing is deleted
            or hidden from a moderator.
          </p>
        </>
      ) : (
        <>
          <p>
            Photos, video, sound recordings and documents. Everything is re-encoded rather than
            passed through, so camera details and location do not survive.
          </p>
          <p>
            This is whether this deployment keeps files at all. Whether a logbook asks for them is
            one of its own questions, so a yes here does not start asking anybody for anything.
          </p>
        </>
      )}
      {note ? (
        <div className="note">
          <span>{note}</span>
        </div>
      ) : null}
      <Choices label={TITLES[kind]} value={chosen ?? ''} onChange={setChosen}>
        {kind === 'publication' ? (
          <>
            <Choice value="yes" title="Yes, publish approved reports">
              The board, the public API, the download and the figures all answer. This is what the
              software does if nobody chooses.
            </Choice>
            <Choice value="no" title="No, keep everything internal">
              All four say that this site does not publish. You can turn it on later and nothing is
              lost in the meantime.
            </Choice>
          </>
        ) : (
          <>
            <Choice value="yes" title="Yes, take files">
              Every kind to begin with. You can narrow the kinds and sizes later, under Files.
            </Choice>
            <Choice value="no" title="No files">
              No logbook takes an upload. Nothing already attached anywhere is affected.
            </Choice>
          </>
        )}
      </Choices>
      <Problem error={save.error} />
      <Actions back={back} pending={save.isPending} disabled={chosen === null} />
    </form>
  );
}

/* ---- the look ------------------------------------------------------- */

const isPreviousDefault = (look: Look) =>
  look.palette === PREVIOUS_DEFAULT_LOOK.palette && look.theme === PREVIOUS_DEFAULT_LOOK.theme;

/**
 * Late on purpose: by now the site has a name, so the previews show theirs.
 * The Look screen's chooser and its two frames (features/settings): choosing
 * changes the frames only. The page behind them takes the look when it is
 * saved, which is one moment and one decision; repainting the whole page on
 * every click turned the two looks being compared into the same place.
 */
function LookStep({ onDone, back }: StepProps) {
  const editor = useQuery({
    queryKey: keys.editor,
    queryFn: ({ signal }) => call(getSiteEditor, { signal }),
  });
  if (editor.isPending) return <Loading />;
  return (
    <LookForm
      // A fresh site starts from the default look. The settings row it was
      // born with still holds the previous default (a migration may not
      // change a column default), so that pair reads as "not chosen yet".
      start={editor.data && !isPreviousDefault(editor.data.look) ? editor.data.look : DEFAULT_LOOK}
      name={editor.data?.name ?? 'ReportLog'}
      onDone={onDone}
      back={back}
    />
  );
}

function LookForm({ start, name, onDone, back }: StepProps & { start: Look; name: string }) {
  const client = useQueryClient();
  const [look, setLookState] = useState<Look>(start);
  const save = useMutation({
    mutationFn: () => call(setLook, { body: look }),
    onSuccess: (state) => {
      // After the save, not before it: painting first would leave somebody
      // looking at a look the deployment does not have if the save failed.
      applyLook(state.look);
      client.setQueryData(keys.editor, state);
      onDone();
    },
  });
  return (
    <form
      style={formStyle}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p>
        A look is a palette, every colour on the site, and a theme: the lettering, the corners and
        how wide the page runs. Pick one and see it on a desktop and a phone. You can change it at
        any time under Site settings.
      </p>
      {/* Said politely as it changes; the frames below are pictures only. */}
      <p aria-live="polite" className="font-semibold">
        Previewing {lookName(look)}.
      </p>
      {/* Side by side from lg up, as on the Look screen: the previews stay in
          view while the chooser scrolls. Frames first below lg. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-start xl:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
        <div className="min-w-0 lg:sticky lg:top-4 lg:order-2">
          <LookFrames look={look} name={parseBrand(name)} fit />
        </div>
        <div className="min-w-0 lg:order-1">
          <LookChooser value={look} onChange={setLookState} />
        </div>
      </div>
      <Problem error={save.error} />
      <Actions back={back} pending={save.isPending} />
    </form>
  );
}

/* ---- the site password ---------------------------------------------- */

function CurtainDecision({
  minPassword,
  onFinished,
  back,
}: {
  minPassword: number;
  onFinished: () => Promise<void>;
  back: (() => void) | undefined;
}) {
  const [decision, setDecision] = useState<'keep' | 'change' | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const finish = useMutation({
    mutationFn: () =>
      call(decideCurtain, {
        body:
          decision === 'change'
            ? { decision, password, passwordConfirm: confirm }
            : { decision: decision ?? '' },
      }),
    onSuccess: onFinished,
  });

  return (
    <form
      style={formStyle}
      onSubmit={(e) => {
        e.preventDefault();
        finish.mutate();
      }}
    >
      <p>
        Whoever installed this deployment chose its site password. Decide whether to keep it. There
        is no default: keeping somebody else’s password should be a choice, not an accident.
      </p>
      <Choices
        label="Keep or change the site password"
        value={decision ?? ''}
        onChange={(v) => {
          setDecision(v === 'keep' ? 'keep' : 'change');
        }}
      >
        <Choice value="change" title="Change it">
          Choose a new password. The old one stops working at once.
        </Choice>
        <Choice value="keep" title="Keep it">
          Everybody who has it now keeps getting in.
        </Choice>
      </Choices>
      {decision === 'change' && (
        <div style={formStyle}>
          <Text
            label="New site password"
            hint={`At least ${String(minPassword)} characters.`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
          <Text
            label="The same password again"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
            }}
          />
        </div>
      )}
      <Problem error={finish.error} />
      <Actions
        back={back}
        pending={finish.isPending}
        disabled={decision === null}
        label="Finish setting up"
      />
    </form>
  );
}
