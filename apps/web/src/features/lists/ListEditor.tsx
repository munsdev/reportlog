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
import { useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Field, FieldDescription, FieldError } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
import { Select } from '../../components/ui/select.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
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
      <div className="space-y-2">
        <Alert tone="serious">{query.error.message}</Alert>
        <Link to="/lists" className="underline">
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
    <Page
      title={list.title}
      lede={
        <>
          The form is at{' '}
          <a href={`/list/${list.slug}`} className="font-mono underline">
            /list/{list.slug}
          </a>
          . {scheduleSentence(list)}{' '}
          {list.requires_email
            ? 'It can collect something personal, so it asks for an email address from anybody who writes something.'
            : 'Nothing it asks is personal, so it asks nobody for an email address.'}
        </>
      }
      actions={
        <Button asChild variant="secondary">
          <Link to="/lists">All lists</Link>
        </Button>
      }
    >
      <Settings list={list} onSaved={refresh} />
      <Questions key={list.fields.map((f) => f.id).join('-')} list={list} onSaved={refresh} />
      <Counts list={list} />
      <Remove list={list} />
    </Page>
  );
}

function Settings({ list, onSaved }: { list: ListAdminDetail; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(list.title);
  const [blurb, setBlurb] = useState(list.blurb ?? '');
  const [visibility, setVisibility] = useState<ListVisibility>(list.visibility);
  const [outside, setOutside] = useState<ListOutsideAccess>(list.outside_access);
  const [emailMode, setEmailMode] = useState<ListEmailMode>(list.email_mode);
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
          blurb,
          visibility,
          outside_access: outside,
          email_mode: emailMode,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
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
            id="list-taking"
            label="Taking entries"
            help="Untick to close the form. Entries already sent are kept."
            checked={taking}
            onChange={setTaking}
          />
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">Opening times</legend>
            <p className="text-sm text-ink-alt">
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
          {save.isError ? <Alert tone="serious">{save.error.message}</Alert> : null}
          {save.isSuccess ? (
            <Alert tone="confirmed">
              {save.data.confirm_sent === true
                ? 'Saved. A link was emailed to the new address; it receives nothing until it is used.'
                : save.data.confirm_sent === false
                  ? 'Saved, but the link to the new address could not be emailed.'
                  : 'Saved.'}
            </Alert>
          ) : null}
          <Button type="submit" disabled={save.isPending}>
            Save the settings
          </Button>
        </form>
      </CardContent>
    </Card>
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
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(on) => {
          onChange(on === true);
        }}
      />
      <div className="flex flex-col">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-sm text-ink-alt">{help}</span>
      </div>
    </div>
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
  options: Array.isArray(q.settings.options) ? (q.settings.options as string[]).join('\n') : '',
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
              .filter(Boolean);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Questions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="max-w-prose text-ink-alt">
          Change the questions here and save them together. The server checks the whole form: a
          question somebody can type into makes the form ask for an email address, and only a
          question with fixed answers can be counted.
        </p>
        <ol className="space-y-4" aria-label="The questions, in order">
          {drafts.map((d, i) => (
            <li
              key={d.id ?? `new-${d.key}-${String(i)}`}
              className="space-y-3 rounded-card border border-line p-4"
            >
              <p className="font-mono text-sm text-muted">
                {d.key || 'new question'} · {d.kind}
              </p>
              {d.id === null ? (
                <Field>
                  <Label>Key</Label>
                  <FieldDescription>
                    What its answers are filed under. Fixed once saved: lowercase letters, numbers
                    and underscores.
                  </FieldDescription>
                  <Input
                    className="font-mono"
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
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={i === 0}
                  aria-label={`Move “${d.label || d.key}” up`}
                  onClick={() => {
                    move(i, -1);
                  }}
                >
                  Up
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={i === drafts.length - 1}
                  aria-label={`Move “${d.label || d.key}” down`}
                  onClick={() => {
                    move(i, 1);
                  }}
                >
                  Down
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label={`Remove “${d.label || d.key}”`}
                  onClick={() => {
                    setDrafts((all) => all.filter((_, j) => j !== i));
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-end gap-3">
          <Field className="min-w-48">
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
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
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
          </Button>
        </div>
        {save.isError ? <Alert tone="serious">{save.error.message}</Alert> : null}
        {save.isSuccess ? <Alert tone="confirmed">The questions are saved.</Alert> : null}
        <Button
          type="button"
          disabled={save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          Save the questions
        </Button>
      </CardContent>
    </Card>
  );
}

/** Unknown kinds count as personal on the server; this only picks a starting lifetime. */
const PERSONAL = new Set(['short_text', 'long_text', 'email', 'place']);

function Counts({ list }: { list: ListAdminDetail }) {
  const { totals, fields } = list.summary;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Counts so far</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p>
          {String(totals.received)} received, {String(totals.approved)} approved,{' '}
          {String(totals.rejected)} rejected.
          {totals.last_entry
            ? ` The last arrived ${new Date(totals.last_entry).toLocaleString()}.`
            : ''}
        </p>
        <p className="text-sm text-ink-alt">
          {list.aggregates_published && list.visibility === 'listed'
            ? 'These counts are published.'
            : 'These counts are for you only: nothing is published.'}
        </p>
        {fields.map((f) => (
          <div key={f.key}>
            <h3 className="font-semibold">{f.label}</h3>
            <ul className="text-sm">
              {f.values.map((v) => (
                <li key={v.value}>
                  {v.value}: {String(v.received)} received, {String(v.approved)} approved
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
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
      <p className="text-sm text-ink-alt">
        This list has taken entries, so it cannot be deleted: that would destroy the links it keeps
        and break every deletion link already emailed. Untick “Taking entries” to close it instead.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        disabled={remove.isPending}
        onClick={() => {
          remove.mutate();
        }}
      >
        Delete this list
      </Button>
      <FieldError>{remove.error?.message}</FieldError>
    </div>
  );
}
