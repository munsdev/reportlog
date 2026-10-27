/**
 * One list: its switches, its questions, and its counts so far.
 *
 * THERE IS NO ONE-WAY DOOR. A list seals nothing, so its questions can be
 * reworded, removed and reordered after entries arrive. A question's key is
 * fixed once saved (its answers are filed under it), so the key box is only
 * offered for a new question. The questions are saved as a whole set, because
 * the rules are about the whole form: whether it must ask for an address is
 * worked out from every question at once, by the server, and shown here.
 */
import { deleteList, replaceListQuestions, updateList } from '@reportlog/contracts';
import type {
  ListAdminDetail,
  ListEmailMode,
  ListOutsideAccess,
  ListQuestion,
  ListVisibility,
  Retention,
} from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { Note } from '@/mockup/NoteBox.tsx';
import { Btn, btnClass } from '@/mockup/StaffBtn.tsx';
import { Panel } from '@/mockup/PanelBox.tsx';
import { CheckOption } from '@/mockup/ChoicesWired.tsx';
import { Field, FieldDescription, FieldError } from '@/mockup/FieldWired.tsx';
import { Input } from '@/mockup/FieldWired.tsx';
import { Label } from '@/mockup/FieldWired.tsx';
import { CoverPanel } from '../builder/CoverPanel.tsx';
import { SettingPanels } from '@/mockup/SettingPanel.tsx';
import { GuardedPanel } from '../settings/panels.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { Select } from '@/mockup/FieldWired.tsx';
import { Textarea } from '@/mockup/FieldWired.tsx';
import { optionArray } from '@reportlog/fields';
import { call } from '../../lib/api.ts';
import { listQuery, listsQuery } from './queries.ts';
import { EMAIL_MODE, OUTSIDE, RETENTION, VISIBILITY } from './words.ts';

const AGGREGATABLE = new Set([
  'choice_one',
  'choice_many',
  'yes_no',
  'number',
  'date',
  'time',
  'datetime',
  'place',
]);
const WITH_OPTIONS = new Set(['choice_one', 'choice_many', 'place']);

/** A stored time as a date-and-time box shows it: in the operator's own clock. */
function localBox(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** What the box holds, sent as UTC so it means the same moment read anywhere. Empty is "no time". */
function fromBox(box: string): string | null {
  if (!box) return null;
  const d = new Date(box);
  return Number.isNaN(d.getTime()) ? box : d.toISOString();
}

/** Whether the form is taking entries, and when that changes, in a sentence. */
function scheduleSentence(list: ListAdminDetail): string {
  const now = new Date();
  const opens = list.opens_at ? new Date(list.opens_at) : null;
  const closes = list.closes_at ? new Date(list.closes_at) : null;
  if (list.accepting) {
    return closes
      ? `It is taking entries until ${closes.toLocaleString()}.`
      : 'It is taking entries.';
  }
  if (list.closed_at) return 'It is not taking entries: it was closed by hand.';
  if (opens && opens > now)
    return `It is not taking entries yet. It opens on ${opens.toLocaleString()}.`;
  if (closes && closes <= now)
    return `It is not taking entries. It closed on ${closes.toLocaleString()}.`;
  return 'It is not taking entries.';
}

export function ListEditor({ id }: { id: number }) {
  const query = useQuery(listQuery(id));
  if (query.isPending) return <p role="status">Opening the list…</p>;
  if (query.isError) {
    return (
      <div className="panel">
        <Note tone="serious">{query.error.message}</Note>
        <Link to="/lists" className="back">
          Back to the lists
        </Link>
      </div>
    );
  }
  return <Editor list={query.data} />;
}

function Editor({ list }: { list: ListAdminDetail }) {
  const qc = useQueryClient();
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: listQuery(list.id).queryKey });
    await qc.invalidateQueries({ queryKey: listsQuery().queryKey, exact: true });
  };
  return (
    <StaffPage
      title={list.title}
      lede={`${scheduleSentence(list)} ${
        list.requires_email
          ? 'It can collect something personal, so it asks for an email address from anybody who writes something.'
          : 'Nothing it asks is personal, so it asks nobody for an email address.'
      }`}
      actions={
        // A plain link, as the logbook's is: the server sends it as a download.
        <a
          href={`/api/admin/lists/${String(list.id)}/file`}
          download={`list-${list.slug}.json`}
          className={btnClass('secondary')}
        >
          Download as file
        </a>
      }
    >
      <Link to="/lists" className="back">
        ← All lists
      </Link>
      <p className="mono">
        The form is at <a href={`/list/${list.slug}`}>/list/{list.slug}</a>
      </p>
      <SettingPanels>
        <div className="grid2 even">
          <Settings list={list} onSaved={refresh} />
          <CoverPanel
            kind="list"
            cover={list.cover}
            save={async (cover) => {
              await call(updateList, { params: { id: list.id }, body: { cover } });
              await refresh();
            }}
          />
        </div>
      </SettingPanels>
      <Questions key={list.fields.map((f) => f.id).join('-')} list={list} onSaved={refresh} />
      <Counts list={list} />
      <Remove list={list} />
    </StaffPage>
  );
}

function Settings({ list, onSaved }: { list: ListAdminDetail; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(list.title);
  const [slug, setSlug] = useState(list.slug);
  const [blurb, setBlurb] = useState(list.blurb ?? '');
  const [visibility, setVisibility] = useState<ListVisibility>(list.visibility);
  const [outside, setOutside] = useState<ListOutsideAccess>(list.outside_access);
  const [emailMode, setEmailMode] = useState<ListEmailMode>(list.email_mode);
  const [writeBack, setWriteBack] = useState(list.write_back);
  const [onFront, setOnFront] = useState(list.show_on_front);
  const [published, setPublished] = useState(list.aggregates_published);
  const [taking, setTaking] = useState(list.closed_at === null);
  // Only a box that differs from what is saved is sent, so saving the other
  // settings never moves a time (a box holds minutes, a saved time may not).
  const savedOpens = localBox(list.opens_at);
  const savedCloses = localBox(list.closes_at);
  const [opens, setOpens] = useState(savedOpens);
  const [closes, setCloses] = useState(savedCloses);
  const [notify, setNotify] = useState(list.notify);
  const [notifyEmail, setNotifyEmail] = useState(
    list.notify_pending_email ?? list.notify_email ?? '',
  );
  const named = list.notify_pending_email ?? list.notify_email ?? '';
  const save = useMutation({
    mutationFn: () =>
      call(updateList, {
        params: { id: list.id },
        body: {
          title,
          ...(slug.trim() !== list.slug ? { slug: slug.trim() } : {}),
          blurb,
          visibility,
          outside_access: outside,
          email_mode: emailMode,
          write_back: writeBack,
          show_on_front: onFront,
          aggregates_published: published,
          closed: !taking,
          ...(opens !== savedOpens ? { opens_at: fromBox(opens) } : {}),
          ...(closes !== savedCloses ? { closes_at: fromBox(closes) } : {}),
          notify,
          ...(notifyEmail.trim() !== named ? { notify_email: notifyEmail.trim() || null } : {}),
        },
      }),
    onSuccess: onSaved,
  });

  const dirty =
    title !== list.title ||
    slug.trim() !== list.slug ||
    blurb !== (list.blurb ?? '') ||
    visibility !== list.visibility ||
    outside !== list.outside_access ||
    emailMode !== list.email_mode ||
    writeBack !== list.write_back ||
    onFront !== list.show_on_front ||
    published !== list.aggregates_published ||
    taking !== (list.closed_at === null) ||
    opens !== savedOpens ||
    closes !== savedCloses ||
    notify !== list.notify ||
    notifyEmail.trim() !== named;
  const resetSave = save.reset;
  const cancel = useCallback(() => {
    setTitle(list.title);
    setSlug(list.slug);
    setBlurb(list.blurb ?? '');
    setVisibility(list.visibility);
    setOutside(list.outside_access);
    setEmailMode(list.email_mode);
    setWriteBack(list.write_back);
    setOnFront(list.show_on_front);
    setPublished(list.aggregates_published);
    setTaking(list.closed_at === null);
    setOpens(savedOpens);
    setCloses(savedCloses);
    setNotify(list.notify);
    setNotifyEmail(named);
    resetSave();
  }, [list, savedOpens, savedCloses, named, resetSave]);

  return (
    <>
      <GuardedPanel
        id="list-settings"
        title="Settings"
        summary={[
          { key: 'Who can see it', value: VISIBILITY[list.visibility].label },
          { key: 'Without the site password', value: OUTSIDE[list.outside_access].label },
          { key: 'Ask for an email address', value: EMAIL_MODE[list.email_mode].label },
          { key: 'Taking entries', value: list.closed_at === null ? 'Yes' : 'No' },
          {
            key: 'Email each new entry',
            value: list.notify ? (list.notify_email ?? list.admin_email ?? 'Yes') : 'No',
          },
        ]}
        dirty={dirty}
        onSave={() => save.mutateAsync()}
        onCancel={cancel}
      >
        <div className="form-stack">
          <Field>
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          </Field>
          <Field>
            <Label>Web address</Label>
            <FieldDescription>
              {`The form is at /${slug.trim() || '…'}. Lowercase letters, numbers and hyphens. Changing it stops the old address working.`}
            </FieldDescription>
            <Input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
              }}
            />
          </Field>
          <Field>
            <Label optional>Description</Label>
            <FieldDescription>Shown under the title on the form.</FieldDescription>
            <Textarea
              rows={3}
              value={blurb}
              onChange={(e) => {
                setBlurb(e.target.value);
              }}
            />
          </Field>
          <Choice
            label="Who can see it"
            value={visibility}
            options={VISIBILITY}
            onChange={setVisibility}
          />
          <Choice
            label="Without the site password"
            value={outside}
            options={OUTSIDE}
            onChange={setOutside}
            help="Only matters while the site has a password, and only a listed list can be opened outside."
          />
          <Choice
            label="Ask for an email address"
            value={emailMode}
            options={EMAIL_MODE}
            onChange={setEmailMode}
          />
          <Tick
            id="list-on-front"
            label="Show on the front page"
            help="While the list is listed and taking entries, it is a button on the front page, added at the end if the page’s buttons do not place it. Off, it is not shown there, whatever the buttons say."
            checked={onFront}
            onChange={setOnFront}
          />
          <Tick
            id="list-write-back"
            label="We’ll write back"
            help="The form tells people the team will use their address to reply, and reviewers can open an entry’s address with “Show address”. Each opening is recorded. Off, nobody on staff can read an address."
            checked={writeBack}
            onChange={setWriteBack}
          />
          <Tick
            id="list-taking"
            label="Taking entries"
            help="Untick to close the form. Entries already sent are kept."
            checked={taking}
            onChange={setTaking}
          />
          <fieldset className="form-stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="lbl">Opening times</legend>
            <p className="muted">
              Both optional. Before it opens and after it closes, the form says so and takes
              nothing. Times are in your own clock. “Taking entries” above still closes it at any
              time.
            </p>
            <Field>
              <Label optional>Opens</Label>
              <Input
                type="datetime-local"
                value={opens}
                onChange={(e) => {
                  setOpens(e.target.value);
                }}
              />
            </Field>
            <Field>
              <Label optional>Closes</Label>
              <Input
                type="datetime-local"
                value={closes}
                onChange={(e) => {
                  setCloses(e.target.value);
                }}
              />
            </Field>
          </fieldset>
          <Tick
            id="list-published"
            label="Publish the counts"
            help="Only for a listed list, and only over the questions ticked as countable. Received and approved are always shown together."
            checked={published}
            onChange={setPublished}
          />
          <Tick
            id="list-notify"
            label="Email each new entry"
            help={`Every answer, and the person’s email address if they gave one. ${
              list.admin_email
                ? `Leave the address empty to send them to ${list.admin_email}.`
                : 'Name an address below.'
            }`}
            checked={notify}
            onChange={setNotify}
          />
          {notify ? (
            <Field>
              <Label optional>Send them to</Label>
              <FieldDescription>
                {list.notify_pending_email
                  ? `Waiting for ${list.notify_pending_email} to agree, using the link we emailed it. Until then nothing is sent there.`
                  : list.notify_email
                    ? `Going to ${list.notify_email}.`
                    : 'Any address other than the administrators’ is sent a link first, and receives nothing until it is used.'}
              </FieldDescription>
              <Input
                type="email"
                value={notifyEmail}
                onChange={(e) => {
                  setNotifyEmail(e.target.value);
                }}
              />
            </Field>
          ) : null}
          {save.isError ? <Note tone="serious">{save.error.message}</Note> : null}
        </div>
      </GuardedPanel>
      {save.isSuccess && save.data.confirm_sent !== null ? (
        <Note tone="done">
          {save.data.confirm_sent
            ? 'Saved. A link was emailed to the new address; it receives nothing until it is used.'
            : 'Saved, but the link to the new address could not be emailed.'}
        </Note>
      ) : null}
    </>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  help,
}: {
  label: string;
  value: T;
  options: Record<T, { label: string; help: string }>;
  onChange: (v: T) => void;
  help?: string;
}) {
  const entries = Object.entries(options) as [T, { label: string; help: string }][];
  return (
    <Field>
      <Label>{label}</Label>
      <FieldDescription>
        {help ? `${help} ` : ''}
        {options[value].help}
      </FieldDescription>
      <Select
        value={value}
        onChange={(e) => {
          onChange(e.target.value as T);
        }}
      >
        {entries.map(([k, o]) => (
          <option key={k} value={k}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function Tick({
  id,
  label,
  help,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <CheckOption
      id={id}
      label={label}
      hint={help}
      checked={checked}
      onCheckedChange={(on) => {
        onChange(on === true);
      }}
    />
  );
}

interface Draft {
  id: number | null;
  key: string;
  kind: string;
  label: string;
  help: string;
  required: boolean;
  options: string;
  max_values: number;
  aggregatable: boolean;
  retention: Retention;
}

const toDraft = (q: ListQuestion): Draft => ({
  id: q.id,
  key: q.key,
  kind: q.kind,
  label: q.label,
  help: q.help ?? '',
  required: q.required,
  // A choice with a code shows as `code | words`, as in the logbook builder.
  options: optionArray(q.settings.options)
    .map((o) => (typeof o === 'string' ? o : `${o.code} | ${o.label}`))
    .join('\n'),
  max_values: q.max_values,
  aggregatable: q.aggregatable,
  retention: q.retention,
});

function Questions({ list, onSaved }: { list: ListAdminDetail; onSaved: () => Promise<void> }) {
  // The kinds a list may ask, from the server: the shared vocabulary less the
  // two that belong to a logbook.
  const kinds = useQuery(listsQuery()).data?.kinds ?? [];
  const [drafts, setDrafts] = useState<Draft[]>(() => list.fields.map(toDraft));
  const [newKind, setNewKind] = useState('short_text');
  const save = useMutation({
    mutationFn: () =>
      call(replaceListQuestions, {
        params: { id: list.id },
        body: {
          fields: drafts.map((d) => {
            const prior = list.fields.find((f) => f.id === d.id);
            const options = d.options
              .split('\n')
              .map((o) => o.trim())
              .filter(Boolean)
              .map((o) => {
                const at = o.indexOf('|');
                return at < 0 ? o : { code: o.slice(0, at).trim(), label: o.slice(at + 1).trim() };
              });
            return {
              id: d.id,
              key: d.key,
              kind: d.kind,
              label: d.label,
              help: d.help || null,
              required: d.required,
              settings: WITH_OPTIONS.has(d.kind)
                ? { ...(prior?.settings ?? {}), options }
                : (prior?.settings ?? {}),
              max_values: d.max_values,
              aggregatable: d.aggregatable,
              retention: d.retention,
            };
          }),
        },
      }),
    onSuccess: onSaved,
  });
  const put = (i: number, change: Partial<Draft>) => {
    setDrafts((all) => all.map((d, j) => (j === i ? { ...d, ...change } : d)));
  };
  const move = (i: number, by: number) => {
    setDrafts((all) => {
      const next = [...all];
      const [d] = next.splice(i, 1);
      if (d) next.splice(i + by, 0, d);
      return next;
    });
  };

  const [open, setOpen] = useState<number | null>(null);
  return (
    <Panel heading="Questions">
      <p className="muted">
        Change the questions here and save them together. The server checks the whole form: a
        question somebody can type into makes the form ask for an email address, and only a question
        with fixed answers can be counted.
      </p>
      <div className="qlist" role="list" aria-label="The questions, in order">
        {drafts.map((d, i) => {
          const editing = open === i || d.id === null;
          const kindLabel = kinds.find((k) => k.id === d.kind)?.label ?? d.kind;
          return (
            <div
              key={d.id ?? `new-${d.key}-${String(i)}`}
              role="listitem"
              style={{ display: 'contents' }}
            >
              <div className="qitem">
                <span className="h" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <b>{d.label || 'New question'}</b>
                  <small>
                    {[
                      kindLabel,
                      d.required ? 'Needed' : null,
                      `kept ${RETENTION[d.retention].label.toLowerCase()}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                  <small className="mono">{d.key || 'new question'}</small>
                </div>
                <div className="acts">
                  <Btn
                    type="button"
                    variant="quiet"
                    disabled={i === 0}
                    aria-label={`Move “${d.label || d.key}” up`}
                    onClick={() => {
                      move(i, -1);
                    }}
                  >
                    ↑
                  </Btn>
                  <Btn
                    type="button"
                    variant="quiet"
                    disabled={i === drafts.length - 1}
                    aria-label={`Move “${d.label || d.key}” down`}
                    onClick={() => {
                      move(i, 1);
                    }}
                  >
                    ↓
                  </Btn>
                  <Btn
                    type="button"
                    variant="secondary"
                    aria-label={`Change “${d.label || d.key}”`}
                    aria-expanded={editing}
                    onClick={() => {
                      setOpen(open === i ? null : i);
                    }}
                  >
                    Change
                  </Btn>
                  <Btn
                    type="button"
                    variant="quiet"
                    aria-label={`Remove “${d.label || d.key}”`}
                    onClick={() => {
                      setOpen(null);
                      setDrafts((all) => all.filter((_, j) => j !== i));
                    }}
                  >
                    Remove
                  </Btn>
                </div>
              </div>
              {editing ? (
                <Panel variant="quiet">
                  <div className="form-stack">
                    {d.id === null ? (
                      <Field>
                        <Label>Key</Label>
                        <FieldDescription>
                          What its answers are filed under. Fixed once saved: lowercase letters,
                          numbers and underscores.
                        </FieldDescription>
                        <Input
                          className="mono"
                          value={d.key}
                          onChange={(e) => {
                            put(i, { key: e.target.value });
                          }}
                        />
                      </Field>
                    ) : null}
                    <Field>
                      <Label>The question</Label>
                      <Input
                        value={d.label}
                        onChange={(e) => {
                          put(i, { label: e.target.value });
                        }}
                      />
                    </Field>
                    <Field>
                      <Label optional>Help under it</Label>
                      <Input
                        value={d.help}
                        onChange={(e) => {
                          put(i, { help: e.target.value });
                        }}
                      />
                    </Field>
                    {WITH_OPTIONS.has(d.kind) ? (
                      <Field>
                        <Label>Choices, one per line</Label>
                        <Textarea
                          rows={4}
                          value={d.options}
                          onChange={(e) => {
                            put(i, { options: e.target.value });
                          }}
                        />
                      </Field>
                    ) : null}
                    {d.kind === 'url' ? (
                      <Field>
                        <Label>How many links it takes</Label>
                        <Input
                          type="number"
                          min={1}
                          max={20}
                          value={d.max_values}
                          onChange={(e) => {
                            put(i, { max_values: Number(e.target.value) || 1 });
                          }}
                        />
                      </Field>
                    ) : null}
                    <Field>
                      <Label>How long its answers are kept</Label>
                      <FieldDescription>{RETENTION[d.retention].help}</FieldDescription>
                      <Select
                        value={d.retention}
                        onChange={(e) => {
                          put(i, { retention: e.target.value as Retention });
                        }}
                      >
                        {(Object.keys(RETENTION) as Retention[]).map((r) => (
                          <option key={r} value={r}>
                            {RETENTION[r].label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Tick
                      id={`q-${String(i)}-required`}
                      label="An answer is needed"
                      help="The form will not send without one."
                      checked={d.required}
                      onChange={(v) => {
                        put(i, { required: v });
                      }}
                    />
                    {AGGREGATABLE.has(d.kind) ? (
                      <Tick
                        id={`q-${String(i)}-countable`}
                        label="Countable"
                        help="Its answers may be counted, and the counts published if the list publishes them."
                        checked={d.aggregatable}
                        onChange={(v) => {
                          put(i, { aggregatable: v });
                        }}
                      />
                    ) : null}
                  </div>
                </Panel>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="acts">
        <Field>
          <Label>Kind of question to add</Label>
          <Select
            value={newKind}
            onChange={(e) => {
              setNewKind(e.target.value);
            }}
          >
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Btn
          type="button"
          variant="secondary"
          onClick={() => {
            setOpen(drafts.length);
            setDrafts((all) => [
              ...all,
              {
                id: null,
                key: '',
                kind: newKind,
                label: '',
                help: '',
                required: false,
                options: '',
                max_values: 1,
                aggregatable: false,
                retention: PERSONAL.has(newKind) ? 'transient' : 'durable',
              },
            ]);
          }}
        >
          Add a question
        </Btn>
      </div>
      {save.isError ? <Note tone="serious">{save.error.message}</Note> : null}
      {save.isSuccess ? <Note tone="done">The questions are saved.</Note> : null}
      <div className="acts">
        <Btn
          type="button"
          variant="primary"
          disabled={save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          Save the questions
        </Btn>
      </div>
    </Panel>
  );
}

/** Unknown kinds count as personal on the server; this only picks a starting lifetime. */
const PERSONAL = new Set(['short_text', 'long_text', 'email', 'place']);

function Counts({ list }: { list: ListAdminDetail }) {
  const { totals, fields } = list.summary;
  return (
    <Panel heading="Counts so far">
      <p>
        {String(totals.received)} {totals.received === 1 ? 'entry' : 'entries'} ·{' '}
        {String(totals.approved)} approved · {String(totals.rejected)} rejected.
        {totals.last_entry
          ? ` The last arrived ${new Date(totals.last_entry).toLocaleString()}.`
          : ''}
      </p>
      <p className="muted">
        {list.aggregates_published && list.visibility === 'listed'
          ? 'These counts are published.'
          : 'These counts are for you only: nothing is published.'}
      </p>
      {fields.map((f) => (
        <div key={f.key}>
          <h3>{f.label}</h3>
          <ul>
            {f.values.map((v) => (
              <li key={v.value}>
                {v.value}: {String(v.received)} received, {String(v.approved)} approved
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Panel>
  );
}

function Remove({ list }: { list: ListAdminDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => call(deleteList, { params: { id: list.id } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: listsQuery().queryKey });
      await navigate({ to: '/lists' });
    },
  });
  if (list.summary.totals.received > 0) {
    return (
      <Panel variant="danger" heading="Delete this list">
        <p className="muted">
          This list has taken entries, so it cannot be deleted: that would destroy the links it
          keeps and break every deletion link already emailed. Untick “Taking entries” to close it
          instead.
        </p>
      </Panel>
    );
  }
  return (
    <Panel variant="danger" heading="Delete this list">
      <div className="acts">
        <Btn
          type="button"
          variant="danger"
          disabled={remove.isPending}
          onClick={() => {
            remove.mutate();
          }}
        >
          Delete this list
        </Btn>
        <FieldError>{remove.error?.message}</FieldError>
      </div>
    </Panel>
  );
}
