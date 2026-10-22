import { COPY_KEYS, THEMES } from '@reportlog/contracts';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrandName, applyLook, rememberedLook } from '../../src/components/ui/site.tsx';
import { HomeButtons } from '../../src/features/home/buttons.tsx';

afterEach(() => {
  document.documentElement.removeAttribute('data-palette');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-panel-head');
  document.documentElement.removeAttribute('data-texture');
  localStorage.clear();
});

describe('applying the look', () => {
  it('names the choice on <html>, and the default (Desk) by naming nothing', () => {
    const root = document.documentElement;
    applyLook({ palette: 'midnight', theme: 'signal', panel_head: 'bar', texture: 'none' });
    expect(root).toHaveAttribute('data-palette', 'midnight');
    expect(root).toHaveAttribute('data-theme', 'signal');
    applyLook({ palette: 'platinum', theme: 'desk', panel_head: 'title-bar', texture: 'none' });
    expect(root).not.toHaveAttribute('data-palette');
    expect(root).not.toHaveAttribute('data-theme');
  });

  it('sets the theme’s layout as the server sent it', () => {
    const root = document.documentElement;
    applyLook({ palette: 'legal-pad', theme: 'notebook', panel_head: 'rule', texture: 'ruled' });
    expect(root).toHaveAttribute('data-panel-head', 'rule');
    expect(root).toHaveAttribute('data-texture', 'ruled');
  });

  it('a bare palette and theme takes the built-in theme’s layout', () => {
    const root = document.documentElement;
    applyLook({ palette: 'phosphor', theme: 'console' });
    const console = THEMES.find((t) => t.id === 'console');
    expect(root).toHaveAttribute('data-panel-head', console?.panelHead);
    expect(root).toHaveAttribute('data-texture', console?.texture);
  });

  it('remembers the last look for the next visit, and only one the site could send', () => {
    const look = {
      palette: 'amber',
      theme: 'desk',
      panel_head: 'title-bar',
      texture: 'none',
    } as const;
    applyLook(look);
    expect(rememberedLook()).toEqual(look);
    localStorage.setItem('rl-look', JSON.stringify({ palette: 'Not an id!', theme: 'desk' }));
    expect(rememberedLook()).toBeNull();
    localStorage.setItem('rl-look', 'not json');
    expect(rememberedLook()).toBeNull();
  });

  it('still paints when storage refuses', () => {
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('refused');
    });
    try {
      applyLook({ palette: 'midnight', theme: 'signal' });
      expect(document.documentElement).toHaveAttribute('data-palette', 'midnight');
    } finally {
      refuse.mockRestore();
    }
  });
});

describe('the two-tone name', () => {
  it('draws each accent in its own colour, and never a status colour', () => {
    render(
      <BrandName
        parts={[
          { text: 'The', mark: '' },
          { text: 'Ruhr', mark: 'a' },
          { text: '.org', mark: 'b' },
        ]}
      />,
    );
    expect(screen.getByText('Ruhr').className).toBe('text-brand');
    expect(screen.getByText('.org').className).toBe('text-muted');
    expect(screen.getByText('The').className).not.toMatch(/serious|confirmed/);
  });
});

describe('the front page’s buttons', () => {
  const button = (ref: string, accent: boolean, href: string | null = `/${ref}`) => ({
    kind: 'builtin' as const,
    ref,
    label: `Go to ${ref}`,
    title: `Go to ${ref}`,
    href,
    action: href ? null : 'alerts',
    blurb: null,
    help: null,
    accent,
  });

  it('makes the first one the accent and the rest secondary', () => {
    render(<HomeButtons buttons={[button('one', true), button('two', false)]} />);
    const links = within(screen.getByRole('list', { name: 'What you can do here' })).getAllByRole(
      'link',
    );
    expect(links.map((l) => l.textContent)).toEqual(['Go to one', 'Go to two']);
    expect(links[0]?.className).toMatch(/bg-action/);
    expect(links[1]?.className).not.toMatch(/bg-action/);
  });

  it('draws the alerts button as the way to the journalist alert sign-up', () => {
    render(<HomeButtons buttons={[button('alerts', true, null)]} />);
    expect(screen.getByRole('link', { name: 'Go to alerts' })).toHaveAttribute(
      'href',
      '/journalists/alerts',
    );
  });

  it('draws no dead button for an action with nowhere to go', () => {
    render(<HomeButtons buttons={[{ ...button('alerts', true, null), action: 'something' }]} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('puts the number of published reports on the board button, in a sentence for a screen reader', () => {
    render(<HomeButtons buttons={[button('board', false)]} published={134} />);
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('134 published reports');
    expect(link).toHaveAttribute('href', '/board');
  });

  it('gives a button its blurb as a second line', () => {
    render(<HomeButtons buttons={[{ ...button('submit', true), blurb: 'Good or bad' }]} />);
    expect(screen.getByRole('link', { name: /Go to submit\s*Good or bad/ })).toBeInTheDocument();
  });
});

describe('the page wording', () => {
  it('every slot an operator can write is read by some page', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.tsx')) files.push(readFileSync(path, 'utf8'));
      }
    };
    // Routes and features: some slots sit in a feature's page (the board,
    // the directory). Read either as `copy.key` or through <CopyText>, or,
    // for the lock screen's paragraph, which arrives on the password check
    // rather than with the wording, drawn with its `data-copy` marker.
    walk(`${import.meta.dirname}/../../src/routes`);
    walk(`${import.meta.dirname}/../../src/features`);
    // Read by the server, which sends it as the sentence of a refusal at the
    // door (apps/api/src/door/index.ts); a page shows it as any error.
    const SERVER_READ: readonly string[] = ['refusal_message'];
    for (const key of COPY_KEYS.filter((k) => !SERVER_READ.includes(k))) {
      expect(
        files.some(
          (f) =>
            f.includes(`copy.${key}`) ||
            f.includes(`<CopyText slot="${key}"`) ||
            f.includes(`data-copy="${key}"`),
        ),
        key,
      ).toBe(true);
    }
  });
});
