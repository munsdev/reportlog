/**
 * Look packs on the website (stage 6): linking the installed packs'
 * stylesheets, only ever from this site; the upload component, which shows
 * the check's sentences before anything is saved and installs only on
 * Install; and the list of installed packs with Remove.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstalledLookPack, LookPackSummary } from '@reportlog/contracts';
import { applyLook, rememberedLook } from '../src/components/ui/site.tsx';
import { AddLookPack } from '../src/features/looks/AddLookPack.tsx';
import { InstalledLookPacks } from '../src/features/looks/InstalledLookPacks.tsx';
import { addsWhat, groupProblems } from '../src/features/looks/queries.ts';
import { linkStylesheets, linkedStylesheets } from '../src/features/looks/stylesheets.ts';

const A = `/api/looks/tideline/${'a'.repeat(64)}.css`;
const B = `/api/looks/harbour-lights/${'b'.repeat(64)}.css`;

afterEach(() => {
  vi.unstubAllGlobals();
  linkStylesheets([]);
  localStorage.clear();
});

describe('linking the pack stylesheets', () => {
  it('links each once, last in <head>, and unlinks one that is gone', () => {
    linkStylesheets([A, B]);
    linkStylesheets([A, B]);
    expect(linkedStylesheets()).toEqual([A, B]);
    expect(document.head.lastElementChild).toHaveAttribute('href', B);
    linkStylesheets([B]);
    expect(linkedStylesheets()).toEqual([B]);
  });

  it('never links anything but this site’s own pack stylesheets', () => {
    linkStylesheets([
      'https://fonts.example.com/look.css',
      '//cdn.example.com/x.css',
      '/api/looks/tideline/../../../evil.css',
      `/api/looks/Tideline/${'a'.repeat(64)}.css`,
      `/api/looks/tideline/${'a'.repeat(63)}.css`,
      'javascript:alert(1)',
      A,
    ]);
    expect(linkedStylesheets()).toEqual([A]);
  });

  it('applyLook links what the server sent, and a look the page made itself leaves them be', () => {
    applyLook({
      palette: 'tideline',
      theme: 'desk',
      panel_head: 'title-bar',
      texture: 'none',
      stylesheets: [A],
    });
    expect(linkedStylesheets()).toEqual([A]);
    applyLook({ palette: 'flint', theme: 'signal' });
    expect(linkedStylesheets()).toEqual([A]);
    // And the remembered look still has them, for the next first paint.
    expect(rememberedLook()?.stylesheets).toEqual([A]);
  });

  it('a remembered look naming another host is not read back at all', () => {
    localStorage.setItem(
      'rl-look',
      JSON.stringify({
        palette: 'flint',
        theme: 'signal',
        panel_head: 'bar',
        texture: 'none',
        stylesheets: ['https://evil.example/look.css'],
      }),
    );
    expect(rememberedLook()).toBeNull();
  });
});

describe('the words', () => {
  it('says what a pack adds', () => {
    expect(addsWhat({ palettes: 3, themes: 1, looks: 2 })).toBe('3 palettes, 1 theme and 2 looks');
    expect(addsWhat({ palettes: 0, themes: 1, looks: 1 })).toBe('1 theme and 1 look');
    expect(addsWhat({ palettes: 2, themes: 0, looks: 0 })).toBe('2 palettes');
  });

  it('groups the check’s sentences by palette or theme', () => {
    expect(
      groupProblems([
        '"style.css" is not allowed in a pack. Only look.json and fonts/*.woff2.',
        'Palette "faint": text-muted on surface is 1.80:1; it needs 4.5:1.',
        'Theme "round" radius must be a number from 0 to 24.',
        'Palette "faint": text-muted on background is 1.70:1; it needs 4.5:1.',
      ]),
    ).toEqual([
      {
        title: 'The pack',
        items: ['"style.css" is not allowed in a pack. Only look.json and fonts/*.woff2.'],
      },
      {
        title: 'Palette "faint"',
        items: [
          'Palette "faint": text-muted on surface is 1.80:1; it needs 4.5:1.',
          'Palette "faint": text-muted on background is 1.70:1; it needs 4.5:1.',
        ],
      },
      { title: 'Theme "round"', items: ['Theme "round" radius must be a number from 0 to 24.'] },
    ]);
  });
});

// ── the screens ─────────────────────────────────────────────────────────

const SUMMARY: LookPackSummary = {
  id: 'tideline',
  label: 'Tideline',
  version: '1.0.0',
  author: 'The ReportLog tests',
  palettes: [
    {
      id: 'tideline',
      label: 'Tideline',
      description: 'Light.',
      dark: false,
      background: '#f4f4f2',
      deep: '#1d2733',
      surface: '#ffffff',
      action: '#1f5fbf',
    },
    {
      id: 'tideline-night',
      label: 'Tideline night',
      description: 'Dark.',
      dark: true,
      background: '#121a24',
      deep: '#0b1118',
      surface: '#1a2533',
      action: '#f2c14e',
    },
  ],
  themes: [
    {
      id: 'tideline',
      label: 'Tideline',
      description: 'Test.',
      panelHead: 'title-bar',
      texture: 'none',
    },
  ],
  looks: [
    { id: 'tideline', label: 'Tideline', palette: 'tideline', theme: 'tideline' },
    { id: 'tideline-night', label: 'Tideline night', palette: 'tideline-night', theme: 'tideline' },
  ],
  fonts: ['Tideline Sans'],
};
const INSTALLED: InstalledLookPack = {
  ...SUMMARY,
  installed_at: '2026-10-22T08:00:00.000Z',
  installed_by: 'owner@example.org',
  stylesheet: A,
  in_use: null,
};

interface Sent {
  url: string;
  method: string;
  body: unknown;
}
/** Answers each call by its method and path; records what was sent. */
function server(answers: Record<string, { status?: number; body: unknown }>) {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? 'GET';
    sent.push({
      url,
      method,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const a = answers[`${method} ${url}`] ?? {
      status: 404,
      body: { error: { code: 'x', message: 'no' } },
    };
    return Promise.resolve(
      new Response(JSON.stringify(a.body), {
        status: a.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  return sent;
}

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

const zipFile = (bytes = 'PK\u0003\u0004 pretend', name = 'tideline.zip') =>
  new File([bytes], name, { type: 'application/zip' });

async function choose(file: File) {
  const user = userEvent.setup();
  const input = document.querySelector<HTMLInputElement>('input[type=file]');
  if (!input) throw new Error('no file input');
  await user.upload(input, file);
  return user;
}

describe('adding looks from a file', () => {
  it('shows every sentence the check returned, grouped, and installs nothing', async () => {
    const sent = server({
      'POST /api/admin/looks/check': {
        body: {
          problems: [
            '"style.css" is not allowed in a pack. Only look.json and fonts/*.woff2.',
            'Palette "bluish": serious must be a red (its hue is 224).',
          ],
          pack: null,
          replaces: null,
        },
      },
    });
    wrap(<AddLookPack />);
    expect(screen.getByRole('button', { name: 'Choose a .zip' })).toBeVisible();
    expect(
      screen.getByText(/A look pack is a \.zip with a look\.json and its fonts\./),
    ).toBeVisible();
    await choose(zipFile());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('tideline.zip cannot be installed');
    expect(within(alert).getByText('Palette "bluish"')).toBeVisible();
    expect(alert).toHaveTextContent('serious must be a red (its hue is 224).');
    expect(alert).toHaveTextContent('"style.css" is not allowed in a pack.');
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
    // The zip went to the check as base64, and nowhere else.
    expect(sent).toEqual([
      {
        url: '/api/admin/looks/check',
        method: 'POST',
        body: { zip: btoa('PK\u0003\u0004 pretend') },
      },
    ]);
  });

  it('lists what a passing pack adds, and installs only on Install', async () => {
    const sent = server({
      'POST /api/admin/looks/check': { body: { problems: [], pack: SUMMARY, replaces: null } },
      'POST /api/admin/looks': { body: { pack: INSTALLED, replaced: null } },
    });
    const onInstalled = vi.fn();
    wrap(<AddLookPack onInstalled={onInstalled} />);
    const user = await choose(zipFile());
    expect(await screen.findByText(/adds 2 palettes, 1 theme and 2 looks\./)).toBeVisible();
    const looks = screen.getByRole('list', { name: 'Looks' });
    expect(
      within(looks)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['TidelineTideline with Tideline', 'Tideline nightTideline night with Tideline']);
    expect(screen.getByText('Tideline (light), Tideline night (dark)')).toBeVisible();
    expect(sent.map((s) => s.url)).toEqual(['/api/admin/looks/check']);

    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(await screen.findByText('Tideline 1.0.0 is installed.')).toBeVisible();
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([
      'POST /api/admin/looks/check',
      'POST /api/admin/looks',
    ]);
    expect(sent[1]?.body).toEqual(sent[0]?.body);
    expect(onInstalled).toHaveBeenCalledWith(INSTALLED, null);
  });

  it('a replacement says which version it replaces', async () => {
    server({
      'POST /api/admin/looks/check': {
        body: { problems: [], pack: { ...SUMMARY, version: '1.1.0' }, replaces: '1.0.0' },
      },
    });
    wrap(<AddLookPack />);
    await choose(zipFile());
    expect(await screen.findByText(/It replaces version 1\.0\.0\./)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Replace version 1.0.0' })).toBeVisible();
  });

  it('a refusal at install time keeps the pack chosen, with the reason', async () => {
    server({
      'POST /api/admin/looks/check': { body: { problems: [], pack: SUMMARY, replaces: null } },
      'POST /api/admin/looks': {
        status: 400,
        body: {
          error: {
            code: 'pack_refused',
            message: 'A palette called "tideline" is already installed from another pack.',
          },
        },
      },
    });
    wrap(<AddLookPack />);
    const user = await choose(zipFile());
    await user.click(await screen.findByRole('button', { name: 'Install' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A palette called "tideline" is already installed from another pack.',
    );
    expect(screen.getByRole('button', { name: 'Install' })).toBeVisible();
  });

  it('a file larger than a pack may be is refused before it is sent', async () => {
    const sent = server({});
    wrap(<AddLookPack />);
    const big = zipFile();
    Object.defineProperty(big, 'size', { value: 11_000_001 });
    await choose(big);
    expect(await screen.findByRole('alert')).toHaveTextContent('The pack is larger than 10 MB.');
    expect(sent).toEqual([]);
  });
});

describe('the installed packs', () => {
  it('lists the built-in pack and each installed one, and says why one cannot go', async () => {
    server({
      'GET /api/admin/looks': {
        body: {
          packs: [
            {
              ...INSTALLED,
              in_use:
                'The site is wearing the palette "Tideline", and it comes from this pack. Choose another look on the Look screen first.',
            },
          ],
        },
      },
    });
    wrap(<InstalledLookPacks />);
    expect(screen.getByText('ReportLog, built in')).toBeVisible();
    expect(screen.getByText('17 palettes · 10 themes · 16 looks')).toBeVisible();
    expect(
      await screen.findByText(/2 palettes · 1 theme · 2 looks · installed 22 Oct 2026 by/),
    ).toBeVisible();
    expect(screen.getByText(/The site is wearing the palette "Tideline"/)).toBeVisible();
  });

  it('Remove asks the server, and shows its refusal in words', async () => {
    const sent = server({
      'GET /api/admin/looks': { body: { packs: [INSTALLED] } },
      'DELETE /api/admin/looks/tideline': {
        status: 409,
        body: {
          error: {
            code: 'in_use',
            message: 'The look "Tideline day" in the pack "Tideline extra" uses its palette.',
          },
        },
      },
    });
    wrap(<InstalledLookPacks />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Remove Tideline' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The look "Tideline day" in the pack "Tideline extra" uses its palette.',
    );
    expect(sent.map((s) => `${s.method} ${s.url}`)).toContain('DELETE /api/admin/looks/tideline');
  });
});
