import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RouterHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteGate, isDoorPath, useGateMode } from '../src/features/identity/gate.tsx';

/** A server that answers these paths with these bodies, and 401 locked to anything else. */
function server(answers: Record<string, unknown>) {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.split('?')[0] ?? url;
    const body = answers[path];
    return Promise.resolve(
      body === undefined
        ? new Response(JSON.stringify({ error: { code: 'locked', message: 'Locked.' } }), {
            status: 401,
          })
        : new Response(JSON.stringify(body), { status: 200 }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function fakeHistory() {
  const unblock = vi.fn();
  const block = vi.fn(() => unblock);
  return { history: { block } as unknown as RouterHistory, block, unblock };
}

function Behind() {
  return <p>The site behind the curtain ({useGateMode()})</p>;
}

function gate(pathname: string, history: RouterHistory) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SiteGate history={history} pathname={pathname}>
        <Behind />
      </SiteGate>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the gate', () => {
  it('shows only the password screen while locked: nothing behind it renders', async () => {
    server({
      '/api/site-access/status': { locked: true, dev_mode_until: null },
      '/api/doors': { doors: [] },
    });
    const { history, block } = fakeHistory();
    gate('/verify/RL-1', history);
    expect(
      await screen.findByRole('heading', { name: 'This site needs a password' }),
    ).toBeVisible();
    expect(screen.queryByText(/behind the curtain/)).toBeNull();
    // Not on a door, so the router is not even mounted to be blocked.
    expect(block).not.toHaveBeenCalled();
  });

  it('offers what an administrator opened, as plain links', async () => {
    server({
      '/api/site-access/status': { locked: true, dev_mode_until: null },
      '/api/doors': {
        doors: [{ kind: 'logbook', slug: 'open', title: 'Open logbook', href: '/file/open' }],
      },
    });
    gate('/', fakeHistory().history);
    const link = await screen.findByRole('link', { name: 'Open logbook' });
    expect(link).toHaveAttribute('href', '/file/open');
  });

  it('renders the site once past the password, unless it still needs setting up', async () => {
    server({
      '/api/site-access/status': { locked: false, dev_mode_until: null },
      '/api/setup/status': { needed: false, hasOwner: true, minPassword: 8 },
    });
    gate('/', fakeHistory().history);
    expect(await screen.findByText('The site behind the curtain (open)')).toBeVisible();
  });

  it('shows the setup wizard instead of the site on a deployment nobody has set up', async () => {
    server({
      '/api/site-access/status': { locked: false, dev_mode_until: null },
      '/api/setup/status': { needed: true, hasOwner: false, minPassword: 8 },
      '/api/auth/me': { signedIn: false },
    });
    gate('/', fakeHistory().history);
    expect(
      await screen.findByRole('heading', { name: 'Who will own this deployment?' }),
    ).toBeVisible();
    expect(screen.queryByText(/behind the curtain/)).toBeNull();
  });

  it('lets one door page render while locked, with navigation blocked', async () => {
    server({ '/api/site-access/status': { locked: true, dev_mode_until: null } });
    const { history, block } = fakeHistory();
    gate('/file/open', history);
    expect(await screen.findByText('The site behind the curtain (door)')).toBeVisible();
    expect(block).toHaveBeenCalledTimes(1);
    interface At {
      href: string;
    }
    const blocker = (
      block.mock.calls[0] as unknown as [
        { blockerFn: (a: { currentLocation: At; nextLocation: At }) => boolean },
      ]
    )[0];
    const from = { href: '/file/open' };
    // Anywhere else is refused...
    expect(blocker.blockerFn({ currentLocation: from, nextLocation: { href: '/' } })).toBe(true);
    expect(
      blocker.blockerFn({ currentLocation: from, nextLocation: { href: '/file/other' } }),
    ).toBe(true);
    // ...and another history entry of the same address (a card) is not.
    expect(blocker.blockerFn({ currentLocation: from, nextLocation: { href: '/file/open' } })).toBe(
      false,
    );
  });

  it('fails closed when the server cannot say', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    gate('/', fakeHistory().history);
    expect(
      await screen.findByRole('heading', { name: 'This site cannot be reached right now' }),
    ).toBeVisible();
    expect(screen.queryByText(/behind the curtain/)).toBeNull();
  });
});

describe('door paths', () => {
  it('are a filing form, the two emailed links and a list form, and nothing else', () => {
    for (const p of [
      '/file/demo',
      '/file/demo/',
      '/file/confirm/abc',
      '/evidence/abc',
      '/list/tips',
    ])
      expect(isDoorPath(p), p).toBe(true);
    for (const p of [
      '/',
      '/board',
      '/file',
      '/file/demo/extra',
      '/access',
      '/verify/RL-1',
      '/list',
      '/evidence',
      '/evidence/abc/files',
    ]) {
      expect(isDoorPath(p), p).toBe(false);
    }
  });
});
