/**
 * Starting points after setup (Settings → Starting points).
 *
 * THE PROMISES UNDER TEST:
 *   - each template shows, before anything is pressed, what it will change;
 *   - choosing one sends nothing: the dialog lists the changes again and
 *     only "Apply it" sends, exactly the body the contract names;
 *   - Cancel sends nothing;
 *   - a refusal says nothing was changed and keeps the dialog open;
 *   - afterwards the page says what was applied and links the draft logbook.
 */
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
import { StartingPointsPage } from '../src/routes/(staff)/settings/starting-points.tsx';

const CATALOGUE = {
  templates: [
    {
      id: 'elections',
      label: 'Election incidents',
      description: 'Observers and voters reporting what went wrong.',
      sets: [
        'Publishes an archive of the reports a moderator approves',
        'Takes files with reports',
      ],
    },
    {
      id: 'blank',
      label: 'Start from nothing',
      description: 'Clears the page text and makes no logbook.',
      sets: ['Clears every piece of page text, back to the shipped wording', 'Publishes nothing'],
    },
  ],
  applied: { id: 'blank', at: '2026-10-19T10:00:00.000Z' },
};

interface Sent {
  method: string;
  url: string;
  body: unknown;
}

function serve(apply: { status: number; body: unknown }) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      sent.push({
        method,
        url,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      const path = url.split('?')[0] ?? '';
      if (method === 'GET' && path === '/api/admin/templates') {
        return Promise.resolve(new Response(JSON.stringify(CATALOGUE), { status: 200 }));
      }
      if (method === 'POST' && path === '/api/admin/templates') {
        return Promise.resolve(new Response(JSON.stringify(apply.body), { status: apply.status }));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
  return sent;
}

function show() {
  const router = createRouter({
    routeTree: createRootRoute({ component: StartingPointsPage }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const writes = (sent: Sent[]) => sent.filter((s) => s.method !== 'GET');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('starting points after setup', () => {
  it('offers each one as a choice card, and shows what it changes once chosen', async () => {
    const sent = serve({ status: 200, body: {} });
    const user = userEvent.setup();
    show();
    const card = await screen.findByRole('radio', { name: 'Election incidents' });
    expect(card).toHaveAccessibleDescription('Observers and voters reporting what went wrong.');
    expect(screen.getByText(/last started from “Start from nothing”/)).toBeInTheDocument();
    expect(screen.queryByText('Takes files with reports')).toBeNull();
    await user.click(card);
    const panel = screen.getByRole('region', { name: 'Election incidents' });
    expect(within(panel).getByText('Takes files with reports')).toBeInTheDocument();
    // Choosing applies nothing.
    expect(writes(sent)).toEqual([]);
  });

  it('sends nothing until "Apply it", then exactly { template }', async () => {
    const sent = serve({
      status: 200,
      body: { applied: 'elections', logbook: { id: 7, slug: 'elections', title: 'Polling day' } },
    });
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('radio', { name: 'Election incidents' }));
    await user.click(screen.getByRole('button', { name: 'Apply it…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply “Election incidents”?' });
    expect(within(dialog).getByText('Takes files with reports')).toBeInTheDocument();
    expect(writes(sent)).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Apply it' }));
    expect(await screen.findByText('Applied “Election incidents”.')).toBeInTheDocument();
    expect(writes(sent)).toEqual([
      { method: 'POST', url: '/api/admin/templates', body: { template: 'elections' } },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: 'Polling day' })).toHaveAttribute(
      'href',
      '/logbooks/7',
    );
  });

  it('sends nothing when cancelled', async () => {
    const sent = serve({ status: 200, body: { applied: 'blank' } });
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('radio', { name: 'Start from nothing' }));
    await user.click(screen.getByRole('button', { name: 'Apply it…' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes(sent)).toEqual([]);
  });

  it('says nothing changed when the server refuses, and keeps the question open', async () => {
    serve({
      status: 400,
      body: { error: 'bad_template', message: 'There is no starting point called that.' },
    });
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('radio', { name: 'Start from nothing' }));
    await user.click(screen.getByRole('button', { name: 'Apply it…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Apply it' }));
    expect(await within(dialog).findByText(/Nothing was changed\./)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
