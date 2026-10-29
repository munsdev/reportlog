/**
 * The Follow along band and the handle it shows: drawn from the accounts an
 * administrator typed in, never from code, and drawn nowhere a placement is
 * switched off or no account is on.
 */
import type { Site } from '@reportlog/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FollowBand } from '../src/features/follow/FollowBand.tsx';
import { socialHandle } from '../src/features/follow/handle.ts';
import { GateContext } from '../src/features/identity/gateMode.ts';
import type { GateMode } from '../src/features/identity/gateMode.ts';

const SITE = {
  plain_name: 'Munich Archive',
  social_links: [
    { id: 'instagram', url: 'https://www.instagram.com/munich.archive' },
    { id: 'bluesky', url: 'https://bsky.app/profile/munich.bsky.social' },
  ],
  social_placements: ['front', 'after_filing'],
  // The band's heading and line come from the site's words.
  copy: { follow_heading: 'Follow along', follow_line: 'Find us elsewhere.' },
} as unknown as Site;

afterEach(() => {
  vi.unstubAllGlobals();
});

function draw(
  placement: Parameters<typeof FollowBand>[0]['placement'],
  site: Site | null = SITE,
  mode: GateMode = 'open',
) {
  // Nothing may be asked: the answer is already there, and a door asks nothing.
  const fetchMock = vi.fn(() => Promise.reject(new Error('no request expected')));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (site) client.setQueryData(['site'], site);
  const view = render(
    <QueryClientProvider client={client}>
      <GateContext.Provider value={mode}>
        <FollowBand placement={placement} bleed />
      </GateContext.Provider>
    </QueryClientProvider>,
  );
  return { view, fetchMock };
}

describe('socialHandle', () => {
  it('reads the name people say from the stored address', () => {
    expect(socialHandle('instagram', 'https://www.instagram.com/munich.archive')).toBe(
      '@munich.archive',
    );
    expect(socialHandle('bluesky', 'https://bsky.app/profile/munich.bsky.social')).toBe(
      '@munich.bsky.social',
    );
    expect(socialHandle('threads', 'https://www.threads.com/@munich')).toBe('@munich');
    expect(socialHandle('mastodon', 'https://mastodon.social/@munich')).toBe(
      '@munich@mastodon.social',
    );
  });

  it('gives none rather than a guess when the address cannot be read', () => {
    expect(socialHandle('facebook', 'not an address')).toBeNull();
    expect(socialHandle('facebook', 'https://www.facebook.com/')).toBeNull();
  });
});

describe('the Follow along band', () => {
  it('is a large link per account with its platform and handle, as a plain link with no referrer', () => {
    draw('front');
    const band = screen.getByRole('region', { name: 'Follow along' });
    const links = within(band).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      'Instagram@munich.archive',
      'Bluesky@munich.bsky.social',
    ]);
    for (const l of links) {
      expect(l).toHaveAttribute('referrerpolicy', 'no-referrer');
      expect(l.getAttribute('rel')).toContain('noopener');
    }
    expect(links[0]).toHaveAttribute('href', 'https://www.instagram.com/munich.archive');
  });

  it('is absent where its placement is switched off', () => {
    const { view } = draw('journalists');
    expect(view.container).toBeEmptyDOMElement();
  });

  it('is absent when no account is on, and when the site has not loaded', () => {
    expect(draw('front', { ...SITE, social_links: [] }).view.container).toBeEmptyDOMElement();
  });

  it('is absent on a door, which asks the server for nothing', () => {
    const { view, fetchMock } = draw('front', null, 'door');
    expect(view.container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('draws every placement when an older answer carries no list', () => {
    const old = { ...SITE } as unknown as Record<string, unknown>;
    delete old.social_placements;
    draw('journalists', old as unknown as Site);
    expect(screen.getByRole('region', { name: 'Follow along' })).toBeInTheDocument();
  });
});
