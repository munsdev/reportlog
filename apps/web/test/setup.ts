import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Radix measures some controls (a checkbox inside a form) with
// ResizeObserver, which jsdom does not have.
class NoResizeObserver {
  observe(): void {
    // jsdom lays nothing out, so nothing ever resizes.
  }
  unobserve(): void {
    // Nothing was observed.
  }
  disconnect(): void {
    // Nothing to disconnect.
  }
}
if (!('ResizeObserver' in globalThis)) globalThis.ResizeObserver = NoResizeObserver;

// jsdom has no matchMedia. The default is a 1280px-wide screen with no
// preferences set (no reduced motion, no dark scheme); a test that needs a
// narrow one stubs its own.
const SCREEN_WIDTH = 1280;
function queryMatches(query: string): boolean {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (min) return SCREEN_WIDTH >= Number(min[1]);
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (max) return SCREEN_WIDTH <= Number(max[1]);
  return false;
}
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: queryMatches(query),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  cleanup();
});

// THE DOOR (src/features/door/) needs a browser's workers and WebCrypto to
// solve its puzzle, which jsdom has neither of. Here it is always ready and
// adds nothing to what a form sends, so these tests see only the form; the
// browser suite solves the real puzzle (e2e/door.spec.ts).
vi.mock('../src/features/door/useDoor.tsx', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    useDoor: () => ({
      ready: true,
      failed: false,
      fields: () => ({}),
      renew: () => undefined,
      website: '',
      setWebsite: () => undefined,
      host: () => undefined,
    }),
  };
});
