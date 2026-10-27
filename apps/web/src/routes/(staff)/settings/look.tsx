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
import { setLook } from '@reportlog/contracts';
import type { Look, SiteEditor } from '@reportlog/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { call } from '@/lib/api.ts';
import { LookChooser } from '../../../features/settings/LookChooser.tsx';
import { LookFrames } from '../../../features/settings/LookPreview.tsx';
import { LookPacks } from '../../../features/settings/LookPacks.tsx';
import {
  LookOptionsPanel,
  LookOptionsProvider,
} from '../../../features/looks/LookOptionsPanel.tsx';
import { lookName, sameLook, useLookCatalogue } from '../../../features/settings/looks.ts';
import { SettingsFrame } from '../../../features/settings/panels.tsx';
import { WithEditor, editorQuery, useSave, useUnsavedChanges } from './-editor.tsx';

export const Route = createFileRoute('/(staff)/settings/look')({
  component: () => (
    <SettingsFrame>
      <StaffPage
        title="Look"
        lede="Pick a look and see it on a desktop and a phone. Nothing on the site changes until you apply it."
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
function useColumnWide(min: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      setWide(el.clientWidth >= min);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => {
      watch.disconnect();
    };
  }, [min]);
  return [ref, wide] as const;
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
  const [column, wide] = useColumnWide(896);

  return (
    <div ref={column} style={{ maxWidth: 960 }}>
      <section className="settings-row" aria-labelledby="look-palette">
        <h2 id="look-palette">Palette and theme</h2>
        <LookChooser value={chosen} onChange={setChosen} current={current} catalogue={catalogue} />
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
        {previewing ? (
          <div className="acts">
            <Btn look="ink" sm flat
              busy={apply.isPending}
              busyLabel="Applying…"
              onClick={() => {
                apply.mutate(chosen, {
                  onSuccess: (next) => {
                    setChosen(next.look);
                    toast.show('The new look is live.');
                  },
                });
              }}
            >
              Apply to the site
            </Btn>
            <Btn look="ghost" sm flat
              
              onClick={() => {
                apply.reset();
                setChosen(current);
              }}
            >
              Back to what the site shows
            </Btn>
          </div>
        ) : null}
        {apply.isError ? (
          <Note tone="serious" title="The look was not applied.">
            {apply.error.message}
          </Note>
        ) : null}
        <LookFrames look={chosen} catalogue={catalogue} fit={wide ? 'always' : false} />
      </section>

      <LookOptionsPanel />

      <LookPacks />
    </div>
  );
}
