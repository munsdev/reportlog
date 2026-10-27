/**
 * The development notice: "Under active development" in the corner of
 * every page. A deploy turns it on for a few hours by itself; this is the
 * manual override, on for a window or off now.
 *
 * A SWITCH, NOT A FORM. It applies the moment it is pressed, so there is
 * nothing unsaved to warn about, and no Save; a toast says it changed
 * (features/settings/Switches.tsx, shared with the settings overview).
 */
import { createFileRoute } from '@tanstack/react-router';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { SettingsFrame } from '../../../features/settings/panels.tsx';
import { DevNotice } from '../../../features/settings/Switches.tsx';

export const Route = createFileRoute('/(staff)/settings/development')({
  component: DevelopmentPage,
});

function DevelopmentPage() {
  return (
    <SettingsFrame>
      <StaffPage title="Development notice" lede="A small notice for testing periods.">
        <p className="muted">
          Each new release turns it on for a few hours by itself, so testers know why something just
          moved. It always switches itself off: a notice left on for good teaches people to ignore
          it. Use this to show it while you are making changes by hand, or to take it down once
          things have settled.
        </p>
        <DevNotice />
      </StaffPage>
    </SettingsFrame>
  );
}
