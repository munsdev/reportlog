/**
 * A staff page's frame: the eyebrow ("ReportLog · Staff"), the title and
 * lede, then the page. The area's other pages are in the staff sidebar
 * (StaffShell.tsx), so a staff page draws no row of area tabs; a page with
 * sections of its own draws a `TabRow` (AreaTabs.tsx) under this.
 */
import type { ComponentProps } from 'react';
import { Page } from '@/components/ui/page.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';

export type StaffPageProps = ComponentProps<typeof Page>;

export function StaffPage({ eyebrow, children, ...props }: StaffPageProps) {
  const siteName = plainSiteName(useSite().data);
  return (
    <Page eyebrow={eyebrow ?? `${siteName} · Staff`} {...props}>
      {children}
    </Page>
  );
}
