import { useEffect } from 'react';

const KINDS = ['dark', 'light', 'staff', 'form', 'door'] as const;

/**
 * The page ground the mock-up's stylesheet keys on <body>: `dark` for loud
 * pages (the front page, the board), `light` for reading and filing pages,
 * plus `staff`, `form` or `door` where the mock-up page has them. Set while
 * the page is shown; back to `light` after.
 */
export function useBodyClass(...kinds: (typeof KINDS)[number][]): void {
  const key = kinds.join(' ');
  useEffect(() => {
    const body = document.body;
    body.classList.remove(...KINDS);
    const list = key ? key.split(' ') : ['light'];
    body.classList.add(...list);
    return () => {
      body.classList.remove(...KINDS);
      body.classList.add('light');
    };
  }, [key]);
}
