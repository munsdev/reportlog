import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

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
