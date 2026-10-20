/**
 * The lock screen (decisions.md §3) and the development badge in front of
 * the password.
 *
 * The lock screen shows the site's name and the operator's paragraph, both
 * from the password check itself, and asks nothing behind the gate to get
 * them. The badge shows there and on a door, from the same answer.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { RouterHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteGate } from '../src/features/identity/gate.tsx';
import { Route as RootRoute } from '../src/routes/__root.tsx';

/** Answers these paths; anything else is refused as locked. Returns what was asked. */
function server(answers: Record<string, unknown>) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = answers[url.split('?')[0] ?? url];
    return Promise.resolve(
      body === undefined
        ? new Response(JSON.stringify({ error: { code: 'locked', message: 'Locked.' } }), {
            status: 401,
          })
        : new Response(JSON.stringify(body), { status: 200 }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return () =>
    fetchMock.mock.calls.map(([input]) =>
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
}

const history = { block: vi.fn(() => vi.fn()) } as unknown as RouterHistory;
const settle = () => new Promise((r) => setTimeout(r, 100));
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

const SITE = {
  name_parts: [
    { text: 'Harbour', mark: '' },
    { text: 'Watch', mark: 'a' },
  ],
  plain_name: 'HarbourWatch',
};

function lockScreen(pathname = '/board') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SiteGate history={history} pathname={pathname}>
        <p>behind the curtain</p>
      </SiteGate>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the lock screen', () => {
  it('shows the site’s name and the operator’s paragraph, line breaks kept', async () => {
    const asked = server({
      '/api/site-access/status': {
        locked: true,
        site: { ...SITE, intro: 'Run by the harbour residents.\nAsk at the office.' },
        dev_mode_until: null,
      },
      '/api/doors': { doors: [] },
    });
    lockScreen();
    expect(
      await screen.findByRole('heading', { name: 'This site needs a password' }),
    ).toBeVisible();
    expect(screen.getByText('Harbour')).toBeVisible();
    expect(screen.getByText('Watch')).toBeVisible();
    const intro = document.querySelector('[data-copy="lock_intro"]');
    expect(intro?.textContent).toBe('Run by the harbour residents.\nAsk at the office.');
    await settle();
    // Nothing behind the gate was asked to draw it.
    expect(asked().sort()).toEqual(['/api/doors', '/api/site-access/status']);
    expect(screen.queryByText('behind the curtain')).toBeNull();
  });

  it('with no paragraph written shows none', async () => {
    server({
      '/api/site-access/status': { locked: true, site: SITE, dev_mode_until: null },
      '/api/doors': { doors: [] },
    });
    lockScreen();
    expect(await screen.findByText('Harbour')).toBeVisible();
    expect(document.querySelector('[data-copy="lock_intro"]')).toBeNull();
  });

  it('wears the development badge while the notice is on, still asking nothing more', async () => {
    const asked = server({
      '/api/site-access/status': { locked: true, site: SITE, dev_mode_until: inAnHour() },
      '/api/doors': { doors: [] },
    });
    lockScreen();
    expect(await screen.findByRole('button', { name: 'Under active development' })).toBeVisible();
    await settle();
    expect(asked().sort()).toEqual(['/api/doors', '/api/site-access/status']);
  });

  it('wears no badge when the notice is off', async () => {
    server({
      '/api/site-access/status': { locked: true, site: SITE, dev_mode_until: null },
      '/api/doors': { doors: [] },
    });
    lockScreen();
    expect(await screen.findByText('Harbour')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Under active development' })).toBeNull();
  });
});

describe('the development badge on a door', () => {
  const Page = () => <p>the page behind the door</p>;
  const routeTree = RootRoute.addChildren([
    createRoute({ getParentRoute: () => RootRoute, path: '/file/$slug', component: Page }),
  ]);

  it('shows from the password check’s answer, and the door asks nothing beyond it', async () => {
    const asked = server({
      '/api/site-access/status': { locked: true, site: SITE, dev_mode_until: inAnHour() },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createRouter({
      routeTree,
      context: { queryClient },
      history: createMemoryHistory({ initialEntries: ['/file/demo'] }),
    });
    render(
      <QueryClientProvider client={queryClient}>
        <SiteGate history={history} pathname="/file/demo">
          <RouterProvider router={router} />
        </SiteGate>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('the page behind the door')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Under active development' })).toBeVisible();
    await settle();
    expect(asked()).toEqual(['/api/site-access/status']);
  });
});
