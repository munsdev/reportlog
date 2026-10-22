/**
 * The builder's switches that are not questions (B2): the freeze, and who
 * can file without the site password. The site's intake switch moved to the
 * settings overview; its tests are in test/settings/settings.test.tsx.
 *
 * THE PROMISES UNDER TEST:
 *   - freezing is asked before it happens, on a card of its own, and
 *     nothing is sent until the second press;
 *   - undoing either is one press;
 *   - the freeze is offered only where there is something to freeze;
 *   - each sends exactly the body its contract names, to its route.
 */
import type { LogbookDetail } from '@reportlog/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FreezePanel, OutsidePanel } from '../src/features/builder/Switches.tsx';

const LB: LogbookDetail = {
  id: 12,
  slug: 'polling-day',
  title: 'Polling day',
  blurb: null,
  state: 'open',
  launched_at: '2026-10-19T10:00:00.000Z',
  opens_at: null,
  closes_at: null,
  closed_at: null,
  created_at: '2026-10-19T09:00:00.000Z',
  updated_at: '2026-10-19T10:00:00.000Z',
  question_count: 2,
  asks_for_files: true,
  files_frozen_at: null,
  outside_access: 'closed',
  email_required: false,
  asks_email: true,
  fields: [],
};

interface Sent {
  method: string;
  url: string;
  body: unknown;
}

/** A fetch answering by path, recording every call. */
function serve(answers: Record<string, unknown>) {
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
      const key = `${method} ${url.split('?')[0] ?? ''}`;
      const answer = key in answers ? answers[key] : { ok: true };
      return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
    }),
  );
  return sent;
}

/** Inside a router, because the freeze panel links to the upload limits. */
function wrap(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
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

describe('the freeze', () => {
  it('asks first, sends nothing until the second press, then sends frozen: true', async () => {
    const sent = serve({
      'POST /api/admin/logbooks/12/files/freeze': {
        ...LB,
        files_frozen_at: '2026-10-19T11:00:00.000Z',
      },
    });
    const refresh = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    wrap(<FreezePanel lb={LB} refresh={refresh} />);

    await user.click(await screen.findByRole('button', { name: 'Freeze uploads…' }));
    expect(screen.getByText('Freeze uploads on this logbook?')).toBeInTheDocument();
    expect(screen.getByText(/Their report can still be sent without them/)).toBeInTheDocument();
    expect(writes(sent)).toEqual([]);

    // Changing one's mind sends nothing either.
    await user.click(screen.getByRole('button', { name: 'Keep taking files' }));
    expect(writes(sent)).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Freeze uploads…' }));
    await user.click(screen.getByRole('button', { name: 'Freeze uploads' }));
    expect(writes(sent)).toEqual([
      { method: 'POST', url: '/api/admin/logbooks/12/files/freeze', body: { frozen: true } },
    ]);
    expect(refresh).toHaveBeenCalled();
  });

  it('says a frozen logbook is frozen, and takes it off in one press', async () => {
    const sent = serve({ 'POST /api/admin/logbooks/12/files/freeze': LB });
    const user = userEvent.setup();
    wrap(
      <FreezePanel
        lb={{ ...LB, files_frozen_at: '2026-10-19T11:00:00.000Z' }}
        refresh={() => Promise.resolve()}
      />,
    );
    expect(await screen.findByText('Uploads are frozen')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Take the freeze off' }));
    expect(writes(sent)).toEqual([
      { method: 'POST', url: '/api/admin/logbooks/12/files/freeze', body: { frozen: false } },
    ]);
  });

  it('is not offered on a logbook that asks for no files', async () => {
    serve({});
    wrap(
      <>
        <p>page</p>
        <FreezePanel lb={{ ...LB, asks_for_files: false }} refresh={() => Promise.resolve()} />
      </>,
    );
    await screen.findByText('page');
    expect(screen.queryByRole('region', { name: 'Files' })).toBeNull();
  });
});

describe('who can file without the site password', () => {
  it('shows the current answer and sends the new one to the door route, by slug', async () => {
    const sent = serve({});
    const refresh = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    wrap(<OutsidePanel lb={LB} refresh={refresh} />);
    const select = await screen.findByLabelText('Who can file without the password');
    expect(select).toHaveValue('closed');
    await user.selectOptions(select, 'door');
    expect(writes(sent)).toEqual([
      {
        method: 'POST',
        url: '/api/access/doors/logbooks/polling-day',
        body: { outside_access: 'door' },
      },
    ]);
    expect(refresh).toHaveBeenCalled();
  });

  it('says on a draft that it applies once launched', async () => {
    serve({});
    wrap(<OutsidePanel lb={{ ...LB, state: 'draft' }} refresh={() => Promise.resolve()} />);
    expect(await screen.findByText(/applies once the logbook has launched/)).toBeInTheDocument();
  });
});
