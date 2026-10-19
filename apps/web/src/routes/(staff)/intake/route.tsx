/**
 * Coordinator intake. Every page here is for a coordinator or manager of an
 * organization, so the layout names the door once, with the same audience
 * as the staff menu's entry (features/staff-nav/entries.ts).
 */
import { Outlet, createFileRoute } from '@tanstack/react-router';
import { OnlyFor } from '../../../features/staff-nav/OnlyFor.tsx';

export const Route = createFileRoute('/(staff)/intake')({
  component: () => (
    <OnlyFor audience={['organization']} who="coordinators and managers of an organization">
      <Outlet />
    </OnlyFor>
  ),
});
