/**
 * The site settings: how it looks, what it is called, the words on its
 * pages, its legal notices, its front page and its starting points. Administrators only: the
 * server refuses everybody else, and StaffOnly says so before it has to.
 *
 * Its pages are reached from the menu and the area tabs (features/nav, the
 * Site settings area in features/staff-nav/entries.ts), not from a row here.
 */
import { Outlet, createFileRoute } from '@tanstack/react-router';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';
import { UnsavedChangesGuard } from './-editor.tsx';

export const Route = createFileRoute('/(staff)/settings')({
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <StaffOnly needs="admin">
      <div className="flex flex-col gap-6">
        <UnsavedChangesGuard>
          <Outlet />
        </UnsavedChangesGuard>
      </div>
    </StaffOnly>
  );
}
