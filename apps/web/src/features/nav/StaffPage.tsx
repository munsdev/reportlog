/**
 * A staff page's frame: the eyebrow ("ReportLog · Staff"), the title and
 * lede, then the area's tabs UNDER them (navigation.md, section 05), then
 * the page. Drawing `<AreaTabs />` here takes the slot from the site frame,
 * so the fallback row at the top of the page steps aside.
 *
 * `area` names the staff area when the address does not (it rarely needs to).
 */
import type { ComponentProps } from 'react';
import { Page } from '@/components/ui/page.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import type { AreaId } from '../staff-nav/entries.ts';
import { AreaTabs } from './AreaTabs.tsx';

export interface StaffPageProps extends ComponentProps<typeof Page> {
  area?: AreaId | undefined;
}

export function StaffPage({ area, eyebrow, children, ...props }: StaffPageProps) {
  const siteName = plainSiteName(useSite().data);
  return (
    <Page eyebrow={eyebrow ?? `${siteName} · Staff`} {...props}>
      <AreaTabs area={area} />
      {children}
    </Page>
  );
}
