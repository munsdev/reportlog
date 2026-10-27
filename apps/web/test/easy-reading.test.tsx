/**
 * Easier reading (docs/design/looks/README.md section 07; checks.md section
 * 03): High contrast (or High contrast dark on a dark site) with Commons,
 * for this browser only, kept under `rl-easy`, applied by the same code that
 * puts the remembered look back, and never in the way of the page when
 * localStorage throws.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaintedLook } from '@reportlog/contracts';
import { applyLook, rememberedLook } from '../src/components/ui/site.tsx';
import { EasyReadingSwitch } from '../src/features/easy-reading/EasyReadingSwitch.tsx';
import {
  EASY_KEY,
  easyLook,
  easyReadingOn,
  setEasyReading,
} from '../src/features/easy-reading/easyReading.ts';

const root = document.documentElement;
const FLINT: PaintedLook = {
  palette: 'flint',
  theme: 'signal',
  panel_head: 'bar',
  texture: 'none',
  dark: false,
};
const MIDNIGHT: PaintedLook = { ...FLINT, palette: 'midnight', dark: true };
const LEGAL_PAD: PaintedLook = {
  palette: 'legal-pad',
  theme: 'notebook',
  panel_head: 'rule',
  texture: 'ruled',
};

function wipe() {
  setEasyReading(false);
  localStorage.clear();
  for (const a of ['data-palette', 'data-theme', 'data-panel-head', 'data-texture'])
    root.removeAttribute(a);
}
beforeEach(wipe);
afterEach(() => {
  vi.restoreAllMocks();
  wipe();
});

describe('the choice', () => {
  it('is off until this reader turns it on, and kept under rl-easy', () => {
    expect(easyReadingOn()).toBe(false);
    setEasyReading(true);
    expect(localStorage.getItem(EASY_KEY)).toBe('on');
    expect(easyReadingOn()).toBe(true);
    setEasyReading(false);
    expect(localStorage.getItem(EASY_KEY)).toBeNull();
    expect(easyReadingOn()).toBe(false);
  });

  it('off, the site’s look is worn as it is', () => {
    expect(easyLook(FLINT, false)).toBe(FLINT);
  });

  it('on a light site: High contrast with Commons, and no page texture', () => {
    expect(easyLook(LEGAL_PAD, true)).toEqual({
      palette: 'contrast',
      theme: 'commons',
      panel_head: 'plain',
      texture: 'none',
      width: 'regular',
      columns: 'single',
      scale: 'large',
      surface: 'filled',
      second: 'solid',
      tag: 'plain',
      dark: false,
    });
  });

  it('on a dark site: High contrast dark, by the server’s word or the built-in pack’s', () => {
    expect(easyLook(MIDNIGHT, true).palette).toBe('contrast-dark');
    // A palette from an installed pack: only the server knows it is dark.
    expect(easyLook({ ...FLINT, palette: 'tideline-night', dark: true }, true).palette).toBe(
      'contrast-dark',
    );
    // A look the page made itself, with no word from the server.
    const bare: PaintedLook = {
      palette: 'midnight',
      theme: 'signal',
      panel_head: 'bar',
      texture: 'none',
    };
    expect(easyLook(bare, true).palette).toBe('contrast-dark');
  });
});

describe('painting it', () => {
  it('applyLook wears it, and remembers the site’s own look, not the easier one', () => {
    setEasyReading(true);
    applyLook(MIDNIGHT);
    expect(root).toHaveAttribute('data-palette', 'contrast-dark');
    expect(root).toHaveAttribute('data-theme', 'commons');
    expect(root).toHaveAttribute('data-texture', 'none');
    expect(rememberedLook()).toMatchObject({ palette: 'midnight', theme: 'signal' });
  });

  it('switching it repaints at once, and switching it off brings the site’s look back', () => {
    applyLook(LEGAL_PAD);
    expect(root).toHaveAttribute('data-palette', 'legal-pad');
    setEasyReading(true);
    expect(root).toHaveAttribute('data-palette', 'contrast');
    expect(root).toHaveAttribute('data-texture', 'none');
    setEasyReading(false);
    expect(root).toHaveAttribute('data-palette', 'legal-pad');
    expect(root).toHaveAttribute('data-texture', 'ruled');
  });

  it('another tab of this browser turning it on repaints this one too', () => {
    applyLook(FLINT);
    localStorage.setItem(EASY_KEY, 'on');
    window.dispatchEvent(new StorageEvent('storage', { key: EASY_KEY, newValue: 'on' }));
    expect(root).toHaveAttribute('data-palette', 'contrast');
  });

  it('is applied before the first render, by the code that puts the remembered look back', async () => {
    localStorage.setItem('rl-look', JSON.stringify(MIDNIGHT));
    localStorage.setItem(EASY_KEY, 'on');
    vi.resetModules();
    // Importing the module is what runs before React renders anything.
    await import('../src/components/ui/site.tsx');
    expect(root).toHaveAttribute('data-palette', 'contrast-dark');
    expect(root).toHaveAttribute('data-theme', 'commons');
  });

  it('and on a first visit, with no look remembered yet', async () => {
    localStorage.setItem(EASY_KEY, 'on');
    vi.resetModules();
    await import('../src/components/ui/site.tsx');
    expect(root).toHaveAttribute('data-palette', 'contrast');
  });
});

describe('when localStorage throws', () => {
  function refuseStorage() {
    for (const m of ['getItem', 'setItem', 'removeItem'] as const)
      vi.spyOn(Storage.prototype, m).mockImplementation(() => {
        throw new Error('SecurityError: storage is blocked');
      });
  }

  it('the page still loads and paints, and the switch still works for this page', async () => {
    refuseStorage();
    vi.resetModules();
    const site = await import('../src/components/ui/site.tsx');
    const easy = await import('../src/features/easy-reading/easyReading.ts');
    const { EasyReadingSwitch: Switch } =
      await import('../src/features/easy-reading/EasyReadingSwitch.tsx');
    site.applyLook(FLINT);
    render(<Switch />);
    const button = screen.getByRole('switch', { name: 'Easier reading' });
    expect(button).toHaveAttribute('aria-checked', 'false');
    await userEvent.setup().click(button);
    expect(button).toHaveAttribute('aria-checked', 'true');
    expect(easy.easyReadingOn()).toBe(true);
    expect(root).toHaveAttribute('data-palette', 'contrast');
    easy.setEasyReading(false);
  });
});

describe('the switch', () => {
  it('is a switch named Easier reading, saying Off and then On', async () => {
    applyLook(FLINT);
    render(<EasyReadingSwitch />);
    const button = screen.getByRole('switch', { name: 'Easier reading' });
    expect(button).toHaveAttribute('aria-checked', 'false');
    expect(button).toHaveTextContent('Easier reading: Off');
    await userEvent.setup().click(button);
    expect(button).toHaveAttribute('aria-checked', 'true');
    expect(button).toHaveTextContent('Easier reading: On');
    expect(localStorage.getItem(EASY_KEY)).toBe('on');
    expect(root).toHaveAttribute('data-palette', 'contrast');
  });

  it('two switches on one page (menu and footer) agree', async () => {
    render(
      <>
        <EasyReadingSwitch onDeep />
        <EasyReadingSwitch />
      </>,
    );
    const [menu, footer] = screen.getAllByRole('switch', { name: 'Easier reading' });
    if (!menu || !footer) throw new Error('two switches');
    await userEvent.setup().click(menu);
    expect(footer).toHaveAttribute('aria-checked', 'true');
  });
});
