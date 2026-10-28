/**
 * The look editor, on the site itself (the owner's call, 28 Oct): a panel at
 * the side of a desktop or at the foot of a phone, over the real page, which
 * wears every change at once. Nothing reaches visitors until Save for
 * everyone; Cancel, or closing, puts the saved look back.
 *
 * Desktop / Phone shows the page as the other kind of screen would, in a
 * frame beside the panel (LivePreview.tsx). The panel stays open while the
 * editor moves between pages, so the board or a report can be checked too.
 *
 * Palette and theme are an administrator's; the header background, motion
 * and grounds are the owner's, as on the Look screen.
 */
import { setLook } from '@reportlog/contracts';
import type { Look, SiteEditor } from '@reportlog/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Btn } from '@/mockup/Btn.tsx';
import { Note } from '@/mockup/Note.tsx';
import { call } from '@/lib/api.ts';
import { editorQuery } from '@/routes/(staff)/settings/-editor.tsx';
import { useMe } from '../../identity/session.ts';
import { LookChooser } from '../../settings/LookChooser.tsx';
import { sameLook, useLookCatalogue } from '../../settings/looks.ts';
import { HeaderBackgroundEditor } from '../header-background/HeaderBackgroundEditor.tsx';
import { LookOptionsProvider, useLookOptionsDraft } from '../LookOptionsPanel.tsx';
import { LivePreview } from './LivePreview.tsx';
import type { Device } from './LivePreview.tsx';
import { setLookOverride } from './override.ts';
import { setLookEditorOpen, useLookEditorOpen } from './state.ts';

export function LookEditor() {
  const open = useLookEditorOpen();
  const editor = useQuery({ ...editorQuery, enabled: open });
  const client = useQueryClient();
  if (!open || !editor.data) return null;
  return (
    <LookOptionsProvider
      state={editor.data}
      onEditor={(next) => {
        client.setQueryData(editorQuery.queryKey, next);
      }}
    >
      <Panel state={editor.data} />
    </LookOptionsProvider>
  );
}

const TABS = [
  ['colours', 'Colours and type'],
  ['header', 'Header'],
  ['motion', 'Motion'],
] as const;

function useNatural(): Device {
  const [d] = useState<Device>(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches
      ? 'desktop'
      : 'phone',
  );
  return d;
}

function Panel({ state }: { state: SiteEditor }) {
  const me = useMe().data;
  const isOwner = me?.signedIn === true && me.roles.includes('owner');
  const d = useLookOptionsDraft();
  const client = useQueryClient();
  const catalogue = useLookCatalogue();
  const { pathname } = useLocation();
  const natural = useNatural();
  const [device, setDevice] = useState<Device>(natural);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('colours');
  const [look, setDraftLook] = useState<Look>(state.look);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const options = d?.draft;

  // The page wears the draft while the panel is open, and the saved look after.
  useEffect(() => {
    setLookOverride({ palette: look.palette, theme: look.theme, options });
  }, [look, options]);
  useEffect(
    () => () => {
      setLookOverride(null);
    },
    [],
  );

  const changed = !sameLook(look, state.look) || (d?.dirty ?? false);
  const close = () => {
    d?.reset();
    setLookEditorOpen(false);
  };
  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      if (!sameLook(look, state.look)) {
        const next = await call(setLook, { body: look });
        client.setQueryData(editorQuery.queryKey, next);
      }
      if (d?.dirty && isOwner) await d.save.mutateAsync(d.draft);
      await client.invalidateQueries({ queryKey: ['site'] });
      setLookEditorOpen(false);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'The look was not saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {device !== natural ? (
        <div className="le-stage" aria-label="Preview">
          <LivePreview path={pathname} device={device} look={{ ...look, options }} />
        </div>
      ) : null}
      <aside className="le-panel" role="dialog" aria-label="Edit the look">
        <div className="le-head">
          <b>Look</b>
          <div className="seg" role="group" aria-label="See it on">
            {(
              [
                ['desktop', 'Desktop'],
                ['phone', 'Phone'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={device === value}
                onClick={() => {
                  setDevice(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="seg le-tabs" role="group" aria-label="Part of the look">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => {
                setTab(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="le-body">
          {tab === 'colours' ? (
            <LookChooser
              value={look}
              onChange={setDraftLook}
              current={state.look}
              catalogue={catalogue}
            />
          ) : null}
          {tab !== 'colours' && !isOwner ? (
            <p className="muted">Only the owner can change the header background and motion.</p>
          ) : null}
          {tab === 'header' && isOwner && d ? (
            <HeaderBackgroundEditor
              header={d.draft.header}
              onChange={(header) => {
                d.setDraft({ ...d.draft, header });
              }}
              kit={d.kit}
              onPickImage={(file) => {
                d.setMessage(undefined);
                d.upload.mutate(file);
              }}
              onRemoveImage={() => {
                d.setMessage(undefined);
                d.remove.mutate();
              }}
              imageMessage={d.message}
              busy={d.upload.isPending || d.remove.isPending}
            />
          ) : null}
          {tab === 'motion' && isOwner && d ? (
            <div className="col" style={{ gap: 18 }}>
              <div className="col" style={{ gap: 6 }}>
                <b>Motion</b>
                <div className="seg" role="group" aria-label="Motion">
                  {(
                    [
                      ['on', 'Parallax'],
                      ['off', 'Still'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={d.draft.motion === value}
                      onClick={() => {
                        d.setDraft({ ...d.draft, motion: value });
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="col" style={{ gap: 6 }}>
                <b>Section grounds</b>
                <div className="seg" role="group" aria-label="Section grounds">
                  {(
                    [
                      ['alternate', 'Alternate'],
                      ['single', 'One ground'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={d.draft.zones === value}
                      onClick={() => {
                        d.setDraft({ ...d.draft, zones: value });
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
        {problem ? (
          <Note tone="serious" title="The look was not saved.">
            {problem}
          </Note>
        ) : null}
        <div className="le-foot">
          <Btn look="ghost" sm flat onClick={close}>
            Cancel
          </Btn>
          <Btn
            look="ink"
            sm
            flat
            busy={saving}
            busyLabel="Saving…"
            disabled={!changed}
            onClick={() => void save()}
          >
            Save for everyone
          </Btn>
        </div>
      </aside>
    </>
  );
}
