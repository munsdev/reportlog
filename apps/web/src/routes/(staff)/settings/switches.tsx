/**
 * Switches: every on/off for the whole site, each once (menu.ts). Before,
 * Accepting reports lived only on the settings overview, which had no menu
 * entry; the archive switch was on that overview and on Moderation settings;
 * Taking files was on File limits, the development notice on two pages and
 * the site password inside the access page.
 *
 * Each panel is the one those pages draw, so a switch behaves the same
 * wherever it is changed while the old pages remain.
 */
import { createFileRoute } from '@tanstack/react-router';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { TakingFilesPanel } from '../../../features/files/staff/FileAdmin.tsx';
import { SitePassword } from '../../../features/identity/AccessHome.tsx';
import { Archive } from '../../../features/moderation/Settings.tsx';
import { SettingsFrame } from '../../../features/settings/panels.tsx';
import { AcceptingReportsPanel, DevNotice } from '../../../features/settings/Switches.tsx';

export const Route = createFileRoute('/(staff)/settings/switches')({
  component: SwitchesPage,
});

function SwitchesPage() {
  return (
    <SettingsFrame>
      <StaffPage
        title="Switches"
        lede="Every on/off for the whole site, in one place. Each applies as soon as it is changed."
      >
        <AcceptingReportsPanel />
        <Archive />
        <TakingFilesPanel />
        <DevNotice />
        <SitePassword />
      </StaffPage>
    </SettingsFrame>
  );
}
