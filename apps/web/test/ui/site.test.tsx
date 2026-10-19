import { COPY_KEYS } from '@reportlog/contracts';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BrandName, applyLook, rememberedLook } from '../../src/components/ui/site.tsx';
import { HomeButtons } from '../../src/routes/index.tsx';

afterEach(() => {
  document.documentElement.removeAttribute('data-palette');
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

describe('applying the look', () => {
  it('names the choice on <html>, and the shipped one by naming nothing', () => {
    const root = document.documentElement;
    applyLook({ palette: 'midnight', theme: 'docket' });
    expect(root).toHaveAttribute('data-palette', 'midnight');
    expect(root).toHaveAttribute('data-theme', 'docket');
    applyLook({ palette: 'flint', theme: 'signal' });
    expect(root).not.toHaveAttribute('data-palette');
    expect(root).not.toHaveAttribute('data-theme');
  });

  it('remembers the last look for the next visit, and only one the site offers', () => {
    applyLook({ palette: 'moss', theme: 'plain' });
    expect(rememberedLook()).toEqual({ palette: 'moss', theme: 'plain' });
    localStorage.setItem('rl-look', JSON.stringify({ palette: 'retired', theme: 'plain' }));
    expect(rememberedLook()).toBeNull();
    localStorage.setItem('rl-look', 'not json');
    expect(rememberedLook()).toBeNull();
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

  it('draws no dead button for an action nothing can do yet', () => {
    render(<HomeButtons buttons={[button('alerts', true, null)]} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
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
    walk(`${import.meta.dirname}/../../src/routes`);
    for (const key of COPY_KEYS) {
      expect(
        files.some((f) => f.includes(`copy.${key}`)),
        key,
      ).toBe(true);
    }
  });
});
