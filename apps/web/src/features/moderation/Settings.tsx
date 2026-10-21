/**
 * Moderation's settings, for administrators: whether the site publishes an
 * archive at all, the words that raise a review flag, which logbooks use
 * editorial notes, and who opened a reporter's contact details.
 *
 * THE KEYWORD LIST HAS THREE STATES and the page says which it is in: the
 * shipped list, the operator's own, or none at all. Showing "none" as "using
 * the shipped list" would lose an operator's decision the next time somebody
 * pressed save.
 */
import { setArchiveSwitch, setNotesSwitch, setReviewKeywords } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Field, FieldDescription } from '../../components/ui/field.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { call } from '../../lib/api.ts';
import { CountsOnlySettings } from '../flood/CountsOnlySettings.tsx';
import { accessLogQuery, archiveQuery, keywordsQuery, notesSwitchesQuery } from './queries.ts';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
    >
      <h2 id={id} className="font-display text-xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsPage() {
  return (
    <Page title="Moderation settings" width="prose">
      <Archive />
      <Keywords />
      <NotesSwitches />
      <CountsOnlySettings />
      <AccessLog />
    </Page>
  );
}

function Archive() {
  const qc = useQueryClient();
  const query = useQuery(archiveQuery);
  const set = useMutation({
    mutationFn: (body: { published?: boolean | null; distribution?: boolean | null }) =>
      call(setArchiveSwitch, { body }),
    onSuccess: (d) => {
      qc.setQueryData(archiveQuery.queryKey, d);
      void qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
  if (!query.data) return null;
  const { published, stored, distribution, distribution_stored } = query.data;
  return (
    <Section title="The public archive">
      <p>
        {published
          ? 'This site publishes approved reports on its board.'
          : 'This site publishes nothing: the board, single reports, the counts and the spreadsheet all say so.'}
        {stored === null ? ' Nobody has chosen, which means it publishes.' : ''}
      </p>
      <p className="text-sm text-ink-alt">
        A reporter permitting publication does not oblige the site to publish, and the site
        publishing never overrides a reporter who said no. Moderation goes on either way.
      </p>
      {set.error ? <Alert tone="serious">{set.error.message}</Alert> : null}
      <Button
        variant="secondary"
        className="self-start"
        disabled={set.isPending}
        onClick={() => {
          set.mutate({ published: !published });
        }}
      >
        {published ? 'Stop publishing the archive' : 'Publish the archive'}
      </Button>
      <h3 className="font-semibold">Downloads of the whole archive</h3>
      <p>
        {distribution
          ? 'Anybody who can read the board can also download it as a spreadsheet, and download each logbook’s published chain file.'
          : !published && distribution_stored === true
            ? 'Downloads are allowed, but nothing is offered while the archive is not published.'
            : 'Nobody can download the board as a spreadsheet or a logbook’s published chain file. Reports are read on the board one page at a time.'}
        {distribution_stored === null ? ' Nobody has chosen, which means no downloads.' : ''}
      </p>
      <p className="text-sm text-ink-alt">
        A download is a copy that leaves this site for good, so this is off until somebody chooses
        it. Your own backups and archive exports are not affected.
      </p>
      <Button
        variant="secondary"
        className="self-start"
        disabled={set.isPending}
        onClick={() => {
          set.mutate({ distribution: distribution_stored !== true });
        }}
      >
        {distribution_stored === true ? 'Stop offering downloads' : 'Offer downloads'}
      </Button>
    </Section>
  );
}

function Keywords() {
  const qc = useQueryClient();
  const query = useQuery(keywordsQuery);
  const [text, setText] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: { terms: string } | { reset: true }) => call(setReviewKeywords, { body }),
    onSuccess: (d) => {
      qc.setQueryData(keywordsQuery.queryKey, d);
      setText(null);
    },
  });
  if (!query.data) return null;
  const k = query.data;
  return (
    <Section title="Words that ask for a second read">
      <p>
        {k.using_default
          ? `Using the list that ships with the software (${String(k.default_count)} terms).`
          : k.terms.length === 0
            ? 'No keyword matching: an administrator chose an empty list.'
            : `Using this site’s own list (${String(k.terms.length)} terms).`}
        {k.set_by ? ` Last changed by ${k.set_by}.` : ''}
      </p>
      <p className="text-sm text-ink-alt">
        A report whose own words (not its chosen answers) contain one of these is marked for a
        second read. That is all it means. Words match whole, and a phrase matches as a phrase.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ terms: text ?? k.terms.join('\n') });
        }}
      >
        <Field>
          <Label>One term per line</Label>
          <Textarea
            rows={10}
            value={text ?? k.terms.join('\n')}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          <FieldDescription>Save an empty box to switch keyword matching off.</FieldDescription>
        </Field>
        {save.error ? <Alert tone="serious">{save.error.message}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending || text === null}>
            Save the list
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={save.isPending}
            onClick={() => {
              save.mutate({ reset: true });
            }}
          >
            Go back to the shipped list
          </Button>
        </div>
      </form>
    </Section>
  );
}

function NotesSwitches() {
  const qc = useQueryClient();
  const query = useQuery(notesSwitchesQuery);
  const set = useMutation({
    mutationFn: (v: { slug: string; enabled: boolean }) =>
      call(setNotesSwitch, { params: { slug: v.slug }, body: { enabled: v.enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['moderation'] }),
  });
  if (!query.data) return null;
  return (
    <Section title="Editorial notes">
      <p className="text-sm text-ink-alt">
        A note is the archive’s own statement about a report it published, under the archive’s name.
        Off for a logbook unless switched on here.
      </p>
      {query.data.logbooks.length === 0 ? <p>No logbook has launched yet.</p> : null}
      <ul className="flex flex-col gap-2">
        {query.data.logbooks.map((l) => (
          <li key={l.slug} className="flex items-center gap-2">
            <Checkbox
              id={`notes-${l.slug}`}
              checked={l.notes_enabled}
              disabled={set.isPending}
              onCheckedChange={(v) => {
                set.mutate({ slug: l.slug, enabled: v === true });
              }}
            />
            <Label htmlFor={`notes-${l.slug}`}>{l.title} uses editorial notes</Label>
          </li>
        ))}
      </ul>
      {set.error ? <Alert tone="serious">{set.error.message}</Alert> : null}
    </Section>
  );
}

function AccessLog() {
  const [shown, setShown] = useState(false);
  return (
    <Section title="Who opened what">
      <p className="text-sm text-ink-alt">
        Every opening of a reporter’s contact details or of a file’s original, with who and why;
        every time an address was opened to ask a reporter for files; and every look at a file’s
        cleaned copy. Reading this list is itself recorded.
      </p>
      {shown ? (
        <AccessLogEntries />
      ) : (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => {
            setShown(true);
          }}
        >
          Show the last twelve months
        </Button>
      )}
    </Section>
  );
}

const LOOKED: Record<string, string> = {
  contact: 'opened the contact details of',
  contact_used: 'had the address opened, to ask for files, of',
  file_original: 'opened a file’s original on',
  file_preview: 'looked at a file’s cleaned copy on',
  chain_file: 'downloaded the complete chain file of',
  desk_link: 'read a checked link on the journalist desk',
  desk_report: 'read, on the journalist desk, the Sources of',
};

function AccessLogEntries() {
  const query = useQuery(accessLogQuery(12));
  if (query.isPending) return <p role="status">Reading the log…</p>;
  if (query.isError) return <Alert tone="serious">{query.error.message}</Alert>;
  // A read of the log itself is recorded, and not listed back here.
  const entries = query.data.entries.filter((e) => e.kind !== 'audit_log');
  if (!entries.length) return <p>Nobody has opened anything protected.</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {entries.map((e) => (
        <li key={e.id}>
          <span className="font-semibold">{e.staff_email}</span> {LOOKED[e.kind] ?? 'opened'}{' '}
          <span className="font-mono">
            {e.public_ref ?? e.logbook ?? (e.kind === 'desk_link' ? '' : 'a report')}
          </span>
          {e.attachment_id === null ? '' : ` (file ${String(e.attachment_id)})`},{' '}
          {new Date(e.accessed_at).toLocaleString()}
          {e.reason ? `: ${e.reason}` : ''}
        </li>
      ))}
    </ul>
  );
}
