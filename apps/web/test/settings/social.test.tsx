/**
 * The social media settings screen.
 *
 * THE PROMISES UNDER TEST:
 *   - a handle says, as it is typed, the link it stands for;
 *   - a platform cannot be switched on without an address, and emptying
 *     the address switches it off;
 *   - an address on the wrong site is refused in words, marked invalid, and
 *     nothing is sent;
 *   - Save sends every platform once, as typed, and the toast says how many
 *     are shown.
 */
import { resolveSocialLinks } from '@reportlog/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsFrame } from '../../src/features/settings/panels.tsx';
import { SocialForm } from '../../src/routes/(staff)/settings/social.tsx';
import { editorState, recordingFetch } from '../site-fixture.ts';

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsFrame>{children}</SettingsFrame>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const group = (name: string) => screen.getByRole('group', { name });

describe('the social media screen', () => {
  it('shows the link a handle stands for, and switches a platform on only once it has one', async () => {
    const user = userEvent.setup();
    const saved = editorState({
      social_links: resolveSocialLinks([
        { id: 'instagram', url: 'https://www.instagram.com/munich', shown: true },
      ]),
    });
    const rec = recordingFetch(saved);
    vi.stubGlobal('fetch', rec.fetchImpl);
    wrap(<SocialForm state={editorState()} />);

    const row = group('Instagram');
    const show = within(row).getByRole('checkbox', { name: 'Show on the site' });
    expect(show).toBeDisabled();
    await user.type(within(row).getByLabelText('Address on Instagram'), '@munich');
    expect(within(row).getByText('Links to https://www.instagram.com/munich')).toBeInTheDocument();
    expect(show).toBeEnabled();
    await user.click(show);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Saved. 1 account is shown.')).toBeInTheDocument();
    const put = rec.sent.find((s) => s.method === 'PUT');
    const links = (put?.body as { links: { id: string; address: string; shown: boolean }[] }).links;
    expect(links).toHaveLength(10);
    expect(links.find((l) => l.id === 'instagram')).toEqual({
      id: 'instagram',
      address: '@munich',
      shown: true,
    });
    expect(links.filter((l) => l.shown)).toHaveLength(1);
  });

  it('switches a platform off when its address is emptied', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', recordingFetch(editorState()).fetchImpl);
    wrap(
      <SocialForm
        state={editorState({
          social_links: resolveSocialLinks([
            { id: 'youtube', url: 'https://www.youtube.com/@munich', shown: true },
          ]),
        })}
      />,
    );
    const row = group('YouTube');
    expect(within(row).getByRole('checkbox', { name: 'Show on the site' })).toBeChecked();
    await user.clear(within(row).getByLabelText('Address on YouTube'));
    expect(within(row).getByRole('checkbox', { name: 'Show on the site' })).not.toBeChecked();
  });

  it('refuses an address on another site before anything is sent', async () => {
    const user = userEvent.setup();
    const rec = recordingFetch(editorState());
    vi.stubGlobal('fetch', rec.fetchImpl);
    wrap(<SocialForm state={editorState()} />);
    const input = within(group('Facebook')).getByLabelText('Address on Facebook');
    await user.type(input, 'https://example.com/munich');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(within(group('Facebook')).getByText(/not on Facebook/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(rec.sent.filter((s) => s.method === 'PUT')).toEqual([]);
  });

  it('offers the five pages for the floating button once it is on, never a form, and sends the choice', async () => {
    const user = userEvent.setup();
    const rec = recordingFetch(editorState());
    vi.stubGlobal('fetch', rec.fetchImpl);
    wrap(<SocialForm state={editorState()} />);
    const box = group('Floating “Follow us” button');
    // The pages are asked only once it is on.
    expect(screen.queryByRole('group', { name: 'On these pages' })).not.toBeInTheDocument();
    await user.click(within(box).getByRole('checkbox', { name: 'Show the button' }));
    const pages = screen.getByRole('group', { name: 'On these pages' });
    expect(
      within(pages)
        .getAllByRole('checkbox')
        .map((c) => c.getAttribute('aria-label') ?? ''),
    ).toHaveLength(5);
    for (const name of ['The front page', 'The board', 'The maps', 'About', 'Journalists']) {
      expect(within(pages).getByRole('checkbox', { name })).toBeChecked();
    }
    expect(within(pages).queryByText(/form/i)).not.toBeInTheDocument();
    await user.click(within(pages).getByRole('checkbox', { name: 'The board' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const put = rec.sent.find((s) => s.method === 'PUT');
    expect((put?.body as { float: unknown }).float).toEqual({
      on: true,
      pages: ['front', 'maps', 'about', 'journalists'],
    });
  });
});
