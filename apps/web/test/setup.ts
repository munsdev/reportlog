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
