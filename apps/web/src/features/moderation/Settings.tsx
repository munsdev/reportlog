/**
 * Moderation's settings, for administrators: whether the site publishes an
 * archive at all, the words that raise a review flag, which logbooks use
 * editorial notes, and who opened a reporter's contact details.
 *
 * Setting panels (moderation.md section 10): each closed panel shows what is
 * set, one editor is open at a time, and the Save bar names what it saves.
 *
 * THE KEYWORD LIST HAS THREE STATES and the page says which it is in: the
 * shipped list, the operator's own, or none at all. Showing "none" as "using
 * the shipped list" would lose an operator's decision the next time somebody
 * pressed save.
 */
import { setArchiveSwitch, setNotesSwitch, setReviewKeywords } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { CheckOption } from '@/mockup/Choice.tsx';
import { Field, FieldDescription, Label, Textarea } from '@/mockup/Field.tsx';
import { SettingPanel, SettingPanels } from '@/mockup/SettingPanel.tsx';
import { ToastProvider, useToast } from '../../components/ui/toast.tsx';
import { call } from '../../lib/api.ts';
import { CountsOnlySettings } from '../flood/CountsOnlySettings.tsx';
import { StaffHead } from './parts.tsx';
import { archiveQuery, keywordsQuery, notesSwitchesQuery } from './queries.ts';

export function SettingsPage() {
  return (
    <ToastProvider>
      <SettingPanels>
        <div className="col" style={{ gap: 18 }}>
          <StaffHead
            title="Moderation settings"
            lede="What the site publishes, what asks for a second read, and who opened what. Each change is recorded with your name."
          />
          <Archive />
          <Keywords />
          <NotesSwitches />
          <CountsOnlySettings />
          <AccessLog />
        </div>
      </SettingPanels>
    </ToastProvider>
  );
}

function Archive() {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery(archiveQuery);
  const [published, setPublished] = useState<boolean | null>(null);
  const [downloads, setDownloads] = useState<boolean | null>(null);
  const set = useMutation({
    mutationFn: (body: { published?: boolean | null; distribution?: boolean | null }) =>
      call(setArchiveSwitch, { body }),
    onSuccess: (d) => {
      qc.setQueryData(archiveQuery.queryKey, d);
      void qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
  const reset = useCallback(() => {
    setPublished(null);
    setDownloads(null);
    set.reset();
  }, [set]);
  if (!query.data) return null;
  const d = query.data;
  const offered = d.distribution_stored === true;
  const nowPublished = published ?? d.published;
  const nowDownloads = downloads ?? offered;
  return (
    <SettingPanel
      id="archive"
      title="The public archive"
      summary={[
        {
          key: 'The archive',
          value: `${d.published ? 'Published on the board.' : 'Not published: the board, single reports, the counts and the spreadsheet all say so.'}${d.stored === null ? ' Nobody has chosen, which means it publishes.' : ''}`,
        },
        {
          key: 'Downloads of the whole archive',
          value: `${
            d.distribution
              ? 'Offered: the board as a spreadsheet, and each logbook’s published chain file.'
              : !d.published && offered
                ? 'Allowed, but nothing is offered while the archive is not published.'
                : 'Not offered.'
          }${d.distribution_stored === null ? ' Nobody has chosen, which means no downloads.' : ''}`,
        },
      ]}
      dirty={nowPublished !== d.published || nowDownloads !== offered}
      onCancel={reset}
      onSave={async () => {
        // Each switch only when it changed: saving one must never set the other.
        const body = {
          ...(nowPublished !== d.published ? { published: nowPublished } : {}),
          ...(nowDownloads !== offered ? { distribution: nowDownloads } : {}),
        };
        if (Object.keys(body).length) await set.mutateAsync(body);
        toast.show('The public archive is saved.');
        reset();
      }}
    >
      <CheckOption
        label="Publish the archive"
        hint="Approved reports appear on the board. A reporter permitting publication does not oblige the site to publish, and the site publishing never overrides a reporter who said no. Moderation goes on either way."
        checked={nowPublished}
        onCheckedChange={(v) => {
          setPublished(v === true);
        }}
      />
      <CheckOption
        label="Offer downloads of the whole archive"
        hint="A download is a copy that leaves this site for good, so this is off until somebody chooses it. Your own backups and archive exports are not affected."
        checked={nowDownloads}
        onCheckedChange={(v) => {
          setDownloads(v === true);
        }}
      />
      {set.error ? <Note tone="serious">{set.error.message}</Note> : null}
    </SettingPanel>
  );
}

function Keywords() {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery(keywordsQuery);
  const [text, setText] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: { terms: string } | { reset: true }) => call(setReviewKeywords, { body }),
    onSuccess: (d) => {
      qc.setQueryData(keywordsQuery.queryKey, d);
      setText(null);
    },
  });
  const reset = useCallback(() => {
    setText(null);
    save.reset();
  }, [save]);
  if (!query.data) return null;
  const k = query.data;
  const shown = k.terms.slice(0, 3).join(', ');
  const which = k.using_default
    ? `The list that ships with the software, ${String(k.default_count)} terms: ${shown}, …`
    : k.terms.length === 0
      ? 'None: an administrator chose an empty list, so nothing asks for a second read.'
      : `This site’s own list, ${String(k.terms.length)} terms: ${shown}${k.terms.length > 3 ? ', …' : ''}`;
  return (
    <SettingPanel
      id="keywords"
      title="Words that ask for a second read"
      summary={[
        { key: 'Words', value: which },
        ...(k.set_by ? [{ key: 'Last changed by', value: k.set_by }] : []),
      ]}
      dirty={text !== null}
      onCancel={reset}
      onSave={async () => {
        if (text !== null) await save.mutateAsync({ terms: text });
        toast.show('The words are saved.');
      }}
    >
      <p className="muted">
        A report whose own words (not its chosen answers) contain one of these is marked for a
        second read. That is all it means. Words match whole, and a phrase matches as a phrase.
      </p>
      <Field>
        <Label>One term per line</Label>
        <FieldDescription>Save an empty box to switch keyword matching off.</FieldDescription>
        <Textarea
          rows={10}
          value={text ?? k.terms.join('\n')}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      </Field>
      {save.error ? <Note tone="serious">{save.error.message}</Note> : null}
      <div className="acts">
        <Btn
          look="ghost"
          sm
          flat
          type="button"

          busy={save.isPending}
          busyLabel="Going back…"
          onClick={() => {
            save.mutate(
              { reset: true },
              {
                onSuccess: () => {
                  toast.show('Back to the shipped list.');
                },
              },
            );
          }}
        >
          Go back to the shipped list
        </Btn>
      </div>
    </SettingPanel>
  );
}

function NotesSwitches() {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery(notesSwitchesQuery);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const set = useMutation({
    mutationFn: (v: { slug: string; enabled: boolean }) =>
      call(setNotesSwitch, { params: { slug: v.slug }, body: { enabled: v.enabled } }),
  });
  const reset = useCallback(() => {
    setChosen({});
    set.reset();
  }, [set]);
  if (!query.data) return null;
  const logbooks = query.data.logbooks;
  const on = logbooks.filter((l) => l.notes_enabled);
  const changed = logbooks.filter((l) => l.slug in chosen && chosen[l.slug] !== l.notes_enabled);
  return (
    <SettingPanel
      id="notes"
      title="Editorial notes"
      summary={[
        {
          key: 'Logbooks using notes',
          value: logbooks.length
            ? on.length
              ? on.map((l) => l.title).join(', ')
              : 'None.'
            : 'No logbook has launched yet.',
        },
      ]}
      dirty={changed.length > 0}
      onCancel={reset}
      onSave={async () => {
        for (const l of changed) {
          await set.mutateAsync({ slug: l.slug, enabled: chosen[l.slug] === true });
        }
        await qc.invalidateQueries({ queryKey: ['moderation'] });
        toast.show('Editorial notes are saved.');
        reset();
      }}
    >
      <p className="muted">
        A note is the archive’s own statement about a report it published, under the archive’s name.
        Off for a logbook unless switched on here.
      </p>
      {logbooks.length === 0 ? <p>No logbook has launched yet.</p> : null}
      <div className="choices">
        {logbooks.map((l) => (
          <div key={l.slug}>
            <CheckOption
              id={`notes-${l.slug}`}
              label={`${l.title} uses editorial notes`}
              checked={chosen[l.slug] ?? l.notes_enabled}
              onCheckedChange={(v) => {
                setChosen((c) => ({ ...c, [l.slug]: v === true }));
              }}
            />
          </div>
        ))}
      </div>
      {set.error ? <Note tone="serious">{set.error.message}</Note> : null}
    </SettingPanel>
  );
}

/**
 * The access log has its own page under Records (settings-and-admin.md §13).
 * This says where it went, for anybody who still looks for it here, and
 * reads nothing: reading the log is a look of its own.
 */
function AccessLog() {
  return (
    <Panel kind="quiet" title="Who opened what" id="who-opened-what">
      <p>
        Every opening of a reporter’s contact details or of a file’s original, with who and why, is
        now its own page under Records: <Link to="/who-opened-what">Who opened protected data</Link>
        . Opening it is recorded.
      </p>
    </Panel>
  );
}
