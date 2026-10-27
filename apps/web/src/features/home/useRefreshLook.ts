import { useEffect } from 'react';

/**
 * Asks the mock-up's page script (public/mockup/site.js) to fit the headlines
 * and draw the header backgrounds again, once the page has been drawn with
 * what `changed` says. The app calls it after every route; this is for a page
 * that changes what it draws without changing route (the editor).
 */
export function useRefreshLook(changed: string): void {
  useEffect(() => {
    const id = requestAnimationFrame(() => window.elRefresh?.());
    return () => {
      cancelAnimationFrame(id);
    };
  }, [changed]);
}
