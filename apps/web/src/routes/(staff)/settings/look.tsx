/**
 * Choosing how the site looks (settings-and-admin.md §04, decision 61).
 *
 * PREVIEW, THEN APPLY. Choosing a look changes the two preview frames and
 * the line above them, and nothing else: the page the administrator is
 * working on does not repaint under them. "Apply to the site" saves palette
 * and theme together, with no step-up (as before), and only then does the
 * site change. "Back to what the site shows" puts the chooser back.
 *
 * LAYOUT. From lg up the chooser (and the packs under it) scroll in a left
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
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { call } from '@/lib/api.ts';
import { cn } from '@/lib/utils.ts';
import { LookChooser } from '../../../features/settings/LookChooser.tsx';
import { LookFrames } from '../../../features/settings/LookPreview.tsx';
import { LookPacks } from '../../../features/settings/LookPacks.tsx';
import {
  LookOptionsPanel,
  LookOptionsProvider,
} from '../../../features/looks/LookOptionsPanel.tsx';
import { lookName, sameLook, useLookCatalogue } from '../../../features/settings/looks.ts';
import { SettingsFrame } from '../../../features/settings/panels.tsx';
import { useWide } from '../../../features/moderation/parts.tsx';
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
  // An element, not a style: the bar below is not rendered at lg and up, so
  // the looks are never two radio groups on a desktop.
  const wide = useWide(1024);

  return (
    <div
      className={cn(
        'grid gap-8 lg:items-start lg:gap-8',
        'lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,46rem)]',
        // Room under the last thing on the page for the pinned bar.
        !wide && 'pb-40',
      )}
    >
      {/* The previews and what applies them: first on a phone, and from lg up
          in view beside the chooser. It scrolls inside itself when the window
          is too short for all of it. */}
      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto lg:p-1 lg:order-2">
        {/* The sentence is the status, not the panel: its buttons are not news. */}
        <Card
          variant="deep"
          className="sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-stretch"
        >
          <p role="status">
            {previewing ? (
              <>
                <span className="label-face block text-xs text-brand-on-deep">Preview only</span>{' '}
                The site is still showing {lookName(current, catalogue)}. You are previewing{' '}
                {lookName(chosen, catalogue)}.
              </>
            ) : (
              <>The site is showing {lookName(current, catalogue)}.</>
            )}
          </p>
          {previewing ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="quiet"
                className="text-on-deep"
                onClick={() => {
                  apply.reset();
                  setChosen(current);
                }}
              >
                Back to what the site shows
              </Button>
              <Button
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
              </Button>
            </div>
          ) : null}
        </Card>
        {apply.isError ? (
          <Alert tone="serious" title="The look was not applied.">
            {apply.error.message}
          </Alert>
        ) : null}

        <LookFrames look={chosen} catalogue={catalogue} fit />
      </div>

      <div className="flex min-w-0 flex-col gap-8 lg:order-1">
        <LookChooser value={chosen} onChange={setChosen} current={current} catalogue={catalogue} />

        <LookPacks />

        <LookOptionsPanel />
      </div>

      {wide ? null : (
        <section
          aria-label="Pick a look"
          className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink bg-surface p-2 print:hidden"
        >
          <LookChooser
            compact
            value={chosen}
            onChange={setChosen}
            current={current}
            catalogue={catalogue}
          />
        </section>
      )}
    </div>
  );
}
