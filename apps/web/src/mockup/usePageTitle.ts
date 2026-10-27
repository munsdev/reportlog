import { useEffect } from 'react';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';

/** The browser tab's title: the page, then the site's name (from settings). */
export function usePageTitle(title: string): void {
  const site = plainSiteName(useSite().data);
  useEffect(() => {
    document.title = `${title} · ${site}`;
  }, [title, site]);
}
