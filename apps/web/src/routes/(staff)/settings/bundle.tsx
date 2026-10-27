/**
 * Import and export of the site's presentation as one file (owner only; the
 * server's scope asks for the owner and the second factor too).
 */
import { createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '@/features/identity/StaffOnly.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { BundlePage } from '@/features/settings/BundlePage.tsx';

export const Route = createFileRoute('/(staff)/settings/bundle')({
  component: () => (
    <StaffOnly needs="owner">
      <StaffPage
        title="Import and export"
        lede="Move how the site reads and looks from one site to another, in one file."
      >
        <BundlePage />
      </StaffPage>
    </StaffOnly>
  ),
});
