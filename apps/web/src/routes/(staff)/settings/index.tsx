/**
 * Site settings, the overview (settings-and-admin.md §03): the whole
 * configuration on one page, every panel showing what is set before it is
 * opened (decision 61 brings the old Admin page's summaries back).
 *
 * Three kinds of panel, by how the setting changes:
 *   - a form, opened in place and saved with the Save bar (Publishing);
 *   - a switch that applies at once, answered by a toast (Accepting
 *     reports, the development notice);
 *   - a setting with a page of its own, linked with Change.
 */
import {
  LEGAL_KINDS,
  SOCIAL_RULES,
  getDoorSettings,
  setArchiveSwitch,
  shownSocialLinks,
} from '@reportlog/contracts';
import type { SiteEditor } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Note } from '@/mockup/NoteBox.tsx';
import { Panel } from '@/mockup/PanelBox.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { Switch } from '@/mockup/Switch.tsx';
import { BrandName, useSite } from '@/components/ui/site.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { call } from '@/lib/api.ts';
import { archiveQuery } from '../../../features/moderation/queries.ts';
import {
  lookName,
  paletteLabel,
  plural,
  themeLabel,
  useLookCatalogue,
} from '../../../features/settings/looks.ts';
import { lookPacksQuery } from '../../../features/looks/queries.ts';
import { LinkPanel, SettingsFrame } from '../../../features/settings/panels.tsx';
import { AcceptingReportsPanel, DevNotice } from '../../../features/settings/Switches.tsx';
import { LEGAL_TITLES } from '../../../features/settings/wording.tsx';
import { editorQuery } from './-editor.tsx';

export const Route = createFileRoute('/(staff)/settings/')({
  component: SettingsHome,
});

const doorQuery = queryOptions({
  queryKey: ['admin', 'door'],
  queryFn: ({ signal }) => call(getDoorSettings, { signal }),
});

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** "12 of 31", and the newest change's day, from the editor's slots. */
export function wordingSummary(copy: SiteEditor['copy']) {
  const written = copy.filter((s) => s.written);
  const newest = written
    .map((s) => s.changed_at)
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1);
  return [
    {
      key: 'Changed from the shipped wording',
      value: `${String(written.length)} of ${String(copy.length)}`,
      mono: true,
    },
    { key: 'Last change', value: newest ? day(newest) : 'None yet' },
  ];
}

function SettingsHome() {
  return (
    <SettingsFrame>
      <StaffPage title="Site settings" lede="The switches that affect the whole site.">
        <div className="grid2 even">
          <AcceptingReportsPanel />
          <PublishingPanel />
          <NamePanel />
          <LookPanel />
          <EditorPanels />
          <SocialPanel />
          <FormsPanel />
          <DevNotice />
        </div>
      </StaffPage>
    </SettingsFrame>
  );
}

/** Whether approved reports appear on the board: the public archive switch. */
function PublishingPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery(archiveQuery);
  const save = useMutation({
    mutationFn: (published: boolean) => call(setArchiveSwitch, { body: { published } }),
    onSuccess: (d) => {
      qc.setQueryData(archiveQuery.queryKey, d);
      void qc.invalidateQueries({ queryKey: ['board'] });
      void qc.invalidateQueries({ queryKey: ['site'] });
      toast.show(d.published ? 'Publishing is now on.' : 'Publishing is now off.');
    },
  });

  if (query.isPending)
    return (
      <Panel heading="Publishing">
        <p role="status">Loading…</p>
      </Panel>
    );
  if (query.isError)
    return (
      <Panel heading="Publishing">
        <Note tone="serious" title="Publishing could not be read.">
          {query.error.message}
        </Note>
      </Panel>
    );
  return (
    <Panel heading="Publishing">
      <Switch
        label="Publish the archive"
        help="Approved reports appear on the board. Turning it off hides them; nothing is deleted. A reporter permitting publication does not oblige the site to publish, and the site publishing never overrides a reporter who said no."
        checked={query.data.published}
        busy={save.isPending}
        onChange={(next) => {
          save.reset();
          save.mutate(next);
        }}
      />
      {query.data.stored === null ? (
        <p className="muted">Nobody has chosen yet, which means on.</p>
      ) : null}
      {save.isError ? (
        <Note tone="serious" title="That was not saved.">
          {save.error.message}
        </Note>
      ) : null}
    </Panel>
  );
}

function NamePanel() {
  const site = useSite();
  return (
    <LinkPanel
      title="This site’s name"
      to="/settings/name"
      summary={[
        {
          key: 'Name',
          value: site.data ? <BrandName parts={site.data.name_parts} /> : '…',
        },
        { key: 'In emails', value: site.data?.plain_name ?? '…' },
      ]}
    />
  );
}

function LookPanel() {
  const editor = useQuery(editorQuery);
  const look = editor.data?.look;
  const catalogue = useLookCatalogue();
  const packs = useQuery(lookPacksQuery).data?.packs.length ?? 0;
  return (
    <LinkPanel
      title="How this site looks"
      to="/settings/look"
      summary={[
        { key: 'Look', value: look ? lookName(look, catalogue) : '…' },
        { key: 'Palette', value: look ? paletteLabel(look.palette, catalogue) : '…' },
        { key: 'Theme', value: look ? themeLabel(look.theme, catalogue) : '…' },
        {
          key: 'Installed looks',
          // The built-in pack counts as one.
          value: `${plural(catalogue.looks.length, 'look', 'looks')}, from ${plural(packs + 1, 'pack', 'packs')}`,
        },
      ]}
    />
  );
}

/** Wording and legal notices, both read from the editor's one answer. */
function EditorPanels() {
  const editor = useQuery(editorQuery);
  if (editor.isError)
    return (
      <Note tone="serious" title="The settings could not be read.">
        {editor.error.message}
      </Note>
    );
  const state = editor.data;
  const terms = state?.copy.find((s) => s.key === 'terms_of_use');
  return (
    <>
      <LinkPanel
        title="Wording"
        to="/settings/words"
        summary={
          state
            ? wordingSummary(state.copy)
            : [{ key: 'Changed from the shipped wording', value: '…' }]
        }
      />
      <LinkPanel
        title="Legal notices"
        to="/settings/legal"
        summary={[
          ...LEGAL_KINDS.map((kind) => {
            const entry = state?.legal.find((l) => l.kind === kind);
            return {
              key: LEGAL_TITLES[kind],
              value: entry ? (entry.published ? 'Written' : 'Outline only, not published') : '…',
            };
          }),
          {
            key: 'Terms',
            value: terms
              ? terms.written
                ? 'Written, on the Wording page'
                : 'Shipped wording'
              : '…',
          },
        ]}
      />
    </>
  );
}

function SocialPanel() {
  const links = useQuery(editorQuery).data?.social_links;
  const shown = links ? shownSocialLinks(links) : null;
  const kept = links ? links.filter((l) => l.url && !l.shown).length : 0;
  return (
    <LinkPanel
      title="Social media"
      to="/settings/social"
      summary={[
        {
          key: 'Shown',
          value: shown
            ? shown.length
              ? shown.map((l) => SOCIAL_RULES[l.id].name).join(', ')
              : 'None'
            : '…',
        },
        ...(kept ? [{ key: 'Kept, switched off', value: String(kept), mono: true }] : []),
      ]}
    />
  );
}

function FormsPanel() {
  const door = useQuery(doorQuery);
  return (
    <LinkPanel
      title="Report and tip forms"
      to="/settings/forms"
      summary={[
        {
          key: 'Minimum time a form is open',
          value: door.data
            ? door.data.min_form_seconds === 0
              ? 'Not checked'
              : plural(door.data.min_form_seconds, 'second', 'seconds')
            : door.isError
              ? 'Could not be read'
              : '…',
        },
      ]}
    />
  );
}
