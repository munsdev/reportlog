/**
 * Choosing how the site looks (settings-and-admin.md §04, decision 61).
 *
 * PREVIEW, THEN APPLY. Choosing a look changes the two preview frames and
 * the line above them, and nothing else: the page the administrator is
 * working on does not repaint under them. "Apply to the site" saves palette
 * and theme together, with no step-up (as before), and only then does the
 * site change. "Back to what the site shows" puts the chooser back.
 *
 * LAYOUT. When the page's own column is 56rem wide (not the window: the
 * sidebar takes a share of it) the chooser (and the packs under it) scroll in a left
 * column while the status line, its buttons and the previews stay in view on
 * the right, so choosing never means scrolling away from what it does. Below
 * lg the previews come first and a bar of the named looks is pinned to the
 * bottom of the screen (the full chooser is still on the page, under them).
 *
 * PALETTE owns every colour; THEME owns type, corners and width and sets no
 * colour, so any pair works. The frames are painted by the site's own
 * stylesheet (features/settings/LookPreview.tsx), never by a colour this
 * screen computed.
 */
import { NameLookTabs } from '../../../features/settings/NameLookTabs.tsx';
import { setLook } from '@reportlog/contracts';
import type { Look, SiteEditor } from '@reportlog/contracts';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { call } from '@/lib/api.ts';
import { LookChooser } from '../../../features/settings/LookChooser.tsx';
import { LivePreview } from '../../../features/looks/editor/LivePreview.tsx';
import type { Device } from '../../../features/looks/editor/LivePreview.tsx';
import { setLookEditorOpen } from '../../../features/looks/editor/state.ts';
import { LookPacks } from '../../../features/settings/LookPacks.tsx';
import { LookOptionsProvider } from '../../../features/looks/LookOptionsPanel.tsx';
import { lookName, sameLook, useLookCatalogue } from '../../../features/settings/looks.ts';
import { SettingsFrame } from '../../../features/settings/panels.tsx';
import { WithEditor, editorQuery, useSave, useUnsavedChanges } from './-editor.tsx';

export const Route = createFileRoute('/(staff)/settings/look')({
  component: () => (
    <SettingsFrame>
      <StaffPage
        title="Name and look"
        lede="Pick a look and see it on a desktop and a phone. Nothing on the site changes until you apply it."
        tabs={<NameLookTabs />}
      >
        <WithEditor>{(state) => <LookScreen state={state} />}</WithEditor>
      </StaffPage>
    </SettingsFrame>
  ),
});

/**
 * Whether the page's own column is at least `min` px wide. The window's width
 * says nothing here: the staff sidebar takes 240px of it, and the page stops
 * growing at the shell's maximum, so a viewport breakpoint put two columns
 * (and four cards across) into a space that held neither.
 */
/** Whether the window is at least 900px wide: the staff layout's own breakpoint. */
function useDesktop() {
  const [yes, setYes] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches,
  );
  useEffect(() => {
    const q = window.matchMedia('(min-width: 900px)');
    const read = () => {
      setYes(q.matches);
    };
    q.addEventListener('change', read);
    return () => {
      q.removeEventListener('change', read);
    };
  }, []);
  return yes;
}

export function LookScreen({ state }: { state: SiteEditor }) {
  const client = useQueryClient();
  return (
    <LookOptionsProvider
      state={state}
      onEditor={(next) => {
        client.setQueryData(editorQuery.queryKey, next);
        void client.invalidateQueries({ queryKey: ['site'] });
      }}
    >
      <LookChoice state={state} />
    </LookOptionsProvider>
  );
}

function LookChoice({ state }: { state: SiteEditor }) {
  const current = state.look;
  const [chosen, setChosen] = useState<Look>(current);
  const toast = useToast();
  // The built-in looks and every installed pack's (stage 6).
  const catalogue = useLookCatalogue();
  const apply = useSave((value: Look) => call(setLook, { body: value }));
  const previewing = !sameLook(chosen, current);
  useUnsavedChanges('the look', previewing);
  // The frames sit under the chooser at the page's own width.
  const desktop = useDesktop();
  const [device, setDevice] = useState<Device>('desktop');
  const navigate = useNavigate();
  const applyIt = () => {
    apply.mutate(chosen, {
      onSuccess: (next) => {
        setChosen(next.look);
        toast.show('The new look is live.');
      },
    });
  };
  const back = () => {
    apply.reset();
    setChosen(current);
  };

  return (
    <div>
      {/* The choices on one side and the site itself, wearing them, beside
          them and in view (the owner's call, 28 Oct): no scrolling between
          what you change and what it does. On a phone the preview sits at
          the top and the choices scroll under it. */}
      <div className="look-split">
        <div className="look-preview-col">
          <div className="seg" role="group" aria-label="Preview on">
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
          <LivePreview
            path="/"
            device={device}
            look={{ palette: chosen.palette, theme: chosen.theme }}
            maxHeight={desktop ? 560 : 300}
          />
        </div>
        <section className="settings-row look-choice-col" aria-labelledby="look-palette">
          <h2 id="look-palette">Palette and theme</h2>
          {/* The sentence is the status, not the panel: its buttons are not news. */}
          <div className="note" role="status">
            <span>
              {previewing ? (
                <>
                  <b>Preview only.</b> The site is still showing {lookName(current, catalogue)}. You
                  are previewing {lookName(chosen, catalogue)}.
                </>
              ) : (
                <>The site is showing {lookName(current, catalogue)}.</>
              )}
            </span>
          </div>
          {previewing && desktop ? (
            <div className="acts">
              <Btn
                look="ink"
                sm
                flat
                busy={apply.isPending}
                busyLabel="Applying…"
                onClick={applyIt}
              >
                Apply to the site
              </Btn>
              <Btn look="ghost" sm flat onClick={back}>
                Back to what the site shows
              </Btn>
            </div>
          ) : null}
          {apply.isError ? (
            <Note tone="serious" title="The look was not applied.">
              {apply.error.message}
            </Note>
          ) : null}
          <LookChooser
            value={chosen}
            onChange={setChosen}
            current={current}
            catalogue={catalogue}
          />
          <p className="muted">
            The header background, motion and section grounds are set on the site itself.
          </p>
          <div className="acts">
            <Btn
              look="ghost"
              sm
              flat
              onClick={() => {
                void navigate({ to: '/' }).then(() => {
                  setLookEditorOpen(true);
                });
              }}
            >
              Edit the look on the site
            </Btn>
          </div>
        </section>
      </div>

      <LookPacks />

      {/* On a phone the decision stays at the foot of the screen while the choices scroll. */}
      {previewing && !desktop ? (
        <div className="phone-decide">
          <div className="in">
            <Btn look="ghost" sm flat onClick={back}>
              Back
            </Btn>
            <Btn look="ink" sm flat busy={apply.isPending} busyLabel="Applying…" onClick={applyIt}>
              Apply
            </Btn>
          </div>
        </div>
      ) : null}
    </div>
  );
}
