/**
 * The front page's buttons editor: a row per button, each with a Target
 * drop-down grouped by kind, Main text and Subtext.
 *
 * THE PROMISES UNDER TEST:
 *   - the Target is a drop-down of what the site owns, grouped, and never a
 *     box to type an address in; one already used by another row is taken;
 *   - a row whose target would not draw is marked "Not showing", with why;
 *   - blank Main text and Subtext are not sent at all (no key);
 *   - Remove really removes: a removed logbook is saved as hidden;
 *   - a new row cannot be saved until it has a target.
 */
import type { HomeButtonsAdmin } from '@reportlog/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeButtonsEditor } from '../src/features/builder/HomeButtonsEditor.tsx';

const base = { action: null, help: null };
const polling = {
  ...base,
  kind: 'logbook' as const,
  ref: 'polling',
  label: 'Polling day',
  href: '/file/polling',
  blurb: 'Tell us what happened',
};
const board = {
  ...base,
  kind: 'builtin' as const,
  ref: 'board',
  label: 'View Live Report Board',
  href: '/board',
  blurb: null,
};
const shut = {
  ...base,
  kind: 'logbook' as const,
  ref: 'shut',
  label: 'Shut logbook',
  href: '/file/shut',
  blurb: null,
};
const where = {
  ...base,
  kind: 'map' as const,
  ref: 'where',
  label: 'Where it happened',
  href: '/map/where',
  blurb: null,
};
const links = {
  ...base,
  kind: 'social' as const,
  ref: 'links',
  label: 'Follow us',
  href: null,
  blurb: null,
};

const DATA: HomeButtonsAdmin = {
  buttons: [
    { ...polling, title: 'Polling day', accent: true },
    { ...board, title: board.label, accent: false },
  ],
  stored: [
    { kind: 'logbook', ref: 'polling' },
    { kind: 'builtin', ref: 'board' },
    { kind: 'logbook', ref: 'shut' },
  ],
  available: { logbooks: [polling], lists: [], builtins: [board], maps: [where], social: [links] },
  targets: [
    { ...polling, showing: true, why_not: null },
    { ...shut, showing: false, why_not: 'It is closed.' },
    { ...where, showing: true, why_not: null },
    { ...board, showing: true, why_not: null },
    { ...links, showing: true, why_not: null },
  ],
  rows: [
    { kind: 'logbook', ref: 'polling' },
    { kind: 'builtin', ref: 'board' },
    { kind: 'logbook', ref: 'shut' },
  ],
};

function open() {
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if ((init?.method ?? 'GET') === 'PUT' && url.includes('/api/admin/home-buttons')) {
        puts.push(JSON.parse(typeof init?.body === 'string' ? init.body : 'null'));
      }
      return Promise.resolve(new Response(JSON.stringify(DATA), { status: 200 }));
    }),
  );
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <HomeButtonsEditor /> }),
    history: createMemoryHistory({ initialEntries: ['/logbooks/front-page'] }),
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return puts;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const row = (i: number) => {
  const found = rows()[i];
  if (!found) throw new Error(`no row ${String(i)}`);
  return found;
};
const rows = () =>
  within(screen.getByRole('list', { name: 'Buttons, in order' })).getAllByRole('listitem');

describe('the front page buttons editor', () => {
  it('offers the target as a grouped drop-down, with no box to type an address in', async () => {
    open();
    await screen.findByRole('list', { name: 'Buttons, in order' });
    const first = rows()[0];
    if (!first) throw new Error('no row');
    // A row is closed to its summary until Change is pressed.
    await userEvent.setup().click(within(first).getByRole('button', { name: /^Change/ }));
    const target = within(first).getByLabelText('Target');
    expect(target.tagName).toBe('SELECT');
    const groups = [...target.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toEqual(['Logbooks', 'Maps', 'Pages', 'Social links']);
    // One already used by another row is taken.
    expect(within(first).getByRole('option', { name: 'View Live Report Board' })).toBeDisabled();
    expect(within(first).getByRole('option', { name: 'Where it happened' })).toBeEnabled();
    expect(within(first).queryByRole('textbox', { name: /address|link|url/i })).toBeNull();
  });

  it('marks a row whose target would not draw, and says why', async () => {
    open();
    await screen.findByRole('list', { name: 'Buttons, in order' });
    expect(within(row(2)).getByText('Not showing: It is closed.')).toBeInTheDocument();
    expect(within(row(0)).queryByText(/Not showing/)).toBeNull();
  });

  it('sends no key for blank wording, a second line only where set, and hides what was removed', async () => {
    const user = userEvent.setup();
    const puts = open();
    await screen.findByRole('list', { name: 'Buttons, in order' });
    // Relabel the site's own button, and give it a second line.
    const boardRow = row(1);
    await user.click(within(boardRow).getByRole('button', { name: /^Change/ }));
    await user.type(within(boardRow).getByLabelText('Main text'), 'The record');
    await user.type(within(boardRow).getByLabelText('Subtext'), 'Everything published');
    // Remove the closed logbook.
    await user.click(screen.getByRole('button', { name: 'Remove: “Shut logbook”' }));
    await user.click(screen.getByRole('button', { name: 'Save this order' }));
    expect(puts).toEqual([
      {
        order: [
          { kind: 'logbook', ref: 'polling' },
          { kind: 'builtin', ref: 'board', label: 'The record', sub: 'Everything published' },
          { kind: 'logbook', ref: 'shut', hidden: true },
        ],
      },
    ]);
  });

  it('adds a button, which cannot be saved until it points at something', async () => {
    const user = userEvent.setup();
    const puts = open();
    await screen.findByRole('list', { name: 'Buttons, in order' });
    await user.click(screen.getByRole('button', { name: 'Add a button' }));
    expect(rows()).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Save this order' })).toBeDisabled();
    await user.selectOptions(within(row(3)).getByLabelText('Target'), 'Follow us');
    expect(screen.getByRole('button', { name: 'Save this order' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Save this order' }));
    const order = (puts[0] as { order: { kind: string; ref: string }[] }).order;
    expect(order[3]).toEqual({ kind: 'social', ref: 'links' });
  });
});
