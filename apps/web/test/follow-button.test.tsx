/**
 * The floating "Follow us" strip: where it is drawn, and where it never is.
 *
 * THE PROMISES UNDER TEST:
 *   - it is drawn only on a page the administrator chose, and only while an
 *     account is shown;
 *   - it is one plain link per account, straight to it, with nothing to open
 *     (the owner's call of 28 Oct, in place of a menu);
 *   - NEVER on a form, a list form or a staff screen, whatever the setting;
 *   - on a door it draws nothing and asks the server nothing.
 */
import type { Site } from '@reportlog/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FollowButton } from '../src/components/ui/follow-button.tsx';
import { GateContext } from '../src/features/identity/gateMode.ts';
import type { GateMode } from '../src/features/identity/gateMode.ts';

const SITE = {
  plain_name: 'Munich Archive',
  social_links: [{ id: 'bluesky', url: 'https://bsky.app/profile/munich.bsky.social' }],
  social_float_pages: ['front', 'about'],
} as unknown as Site;

afterEach(() => {
  vi.unstubAllGlobals();
});

async function at(
  pathname: string,
  { site = SITE, mode = 'open' }: { site?: Site; mode?: GateMode } = {},
) {
  const fetchMock = vi.fn(() => Promise.reject(new Error('no request expected')));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['site'], site);
  client.setQueryData(['site-access', 'status'], { locked: false });
  const root = createRootRoute({
    component: () => (
      <GateContext.Provider value={mode}>
        <FollowButton />
        <Outlet />
      </GateContext.Provider>
    ),
  });
  const any = createRoute({ getParentRoute: () => root, path: '$', component: () => <p>page</p> });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <p>page</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([index, any]),
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  return fetchMock;
}

const button = () => screen.queryByRole('navigation', { name: 'Follow Munich Archive' });

describe('the Follow us button', () => {
  it('is drawn on a chosen page, as a plain link per account with no referrer', async () => {
    await at('/about');
    expect(button()).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Munich Archive on Bluesky' });
    expect(link).toHaveAttribute('href', 'https://bsky.app/profile/munich.bsky.social');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('is drawn on the front page, and not on a public page that was not chosen', async () => {
    await at('/');
    expect(button()).toBeInTheDocument();
  });

  it('is not drawn on a page the administrator did not choose', async () => {
    await at('/board');
    expect(button()).not.toBeInTheDocument();
  });

  it('is not drawn while no account is shown, or while it is off', async () => {
    await at('/about', { site: { ...SITE, social_links: [] } as unknown as Site });
    expect(button()).not.toBeInTheDocument();
  });

  it('is never on a filing form, a list form or a staff screen, even when every page is chosen', async () => {
    const every = {
      ...SITE,
      social_float_pages: ['front', 'board', 'maps', 'about', 'journalists'],
    } as unknown as Site;
    for (const path of [
      '/file/elections',
      '/list/contact',
      '/submit',
      '/settings/social',
      '/home',
    ]) {
      await at(path, { site: every });
      expect(button(), path).not.toBeInTheDocument();
      document.body.innerHTML = '';
    }
  });

  it('on a door draws nothing and asks the server nothing', async () => {
    const fetched = await at('/about', { mode: 'door' });
    expect(button()).not.toBeInTheDocument();
    expect(fetched).not.toHaveBeenCalled();
  });
});
