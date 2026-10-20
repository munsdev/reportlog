/**
 * The owner's backups and exports screen (decision 10).
 *
 * THE PROMISES UNDER TEST:
 *   - each finished file is offered by this site's own address, nowhere else;
 *   - the page says, before anything is downloaded, that downloading is
 *     recorded in the audit trail;
 *   - starting sends exactly the contract's body, and nothing can be started
 *     while something is being made;
 *   - restoring is a command for the server, never a button;
 *   - an administrator who is not the owner sees a refusal, not the page.
 */
import type { CopiesState } from '@reportlog/contracts';
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
import { BackupsPage } from '../src/features/backups/BackupsPage.tsx';
import { StaffOnly } from '../src/features/identity/StaffOnly.tsx';

const STATE: CopiesState = {
  unavailable: null,
  backups: [
    {
      name: 'reportlog-2026-10-20T03-00-00Z.dump',
      bytes: 5 * 1024 * 1024,
      made_at: '2026-10-20T03:00:00.000Z',
    },
  ],
  exports: [
    {
      name: 'reportlog-archive-2026-10-19T12-00-00Z.json',
      bytes: 300 * 1024,
      made_at: '2026-10-19T12:00:00.000Z',
    },
  ],
  backup_health: { state: 'ok', max_age_hours: 48 },
  offsite: null,
  failure: null,
  running: null,
  last: null,
  restore_command: "sudo systemctl stop reportlog-api\nsudo -u reportlog sh -c 'pg_restore …'",
};

interface Sent {
  method: string;
  url: string;
  body: unknown;
}

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
      if (!(key in answers)) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'nope', message: 'No.' } }), {
            status: 404,
          }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify(answers[key]), { status: 200 }));
    }),
  );
  return sent;
}

function wrap(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ['/backups'] }),
  });
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the backups and exports screen', () => {
  it('offers each file by this site’s own address, and says first that downloading is recorded', async () => {
    serve({ 'GET /api/admin/copies': STATE });
    wrap(<BackupsPage />);
    expect(
      await screen.findByRole('heading', { name: 'Backups and exports', level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Every download is recorded/)).toBeInTheDocument();
    const backup = screen.getByRole('link', {
      name: 'Download reportlog-2026-10-20T03-00-00Z.dump',
    });
    expect(backup).toHaveAttribute(
      'href',
      '/api/admin/copies/backup/reportlog-2026-10-20T03-00-00Z.dump',
    );
    const exported = screen.getByRole('link', {
      name: 'Download reportlog-archive-2026-10-19T12-00-00Z.json',
    });
    expect(exported).toHaveAttribute(
      'href',
      '/api/admin/copies/export/reportlog-archive-2026-10-19T12-00-00Z.json',
    );
    // Every link on the page stays on this site.
    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('href') ?? '').toMatch(/^\//);
    }
    // Restoring is a command for the server, not a button.
    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();
    expect(screen.getByText(/pg_restore/)).toBeInTheDocument();
  });

  it('starting sends the contract’s body, and nothing more can start while it runs', async () => {
    const user = userEvent.setup();
    const sent = serve({
      'GET /api/admin/copies': STATE,
      'POST /api/admin/copies': {
        ...STATE,
        running: {
          kind: 'export',
          started_at: '2026-10-20T06:00:00.000Z',
          finished_at: null,
          ok: null,
          summary: null,
        },
      },
    });
    wrap(<BackupsPage />);
    await user.click(await screen.findByRole('button', { name: 'Make an export' }));
    expect(await screen.findByText(/Making an export…/)).toBeInTheDocument();
    expect(sent.filter((s) => s.method === 'POST')).toEqual([
      { method: 'POST', url: '/api/admin/copies', body: { kind: 'export' } },
    ]);
    expect(screen.getByRole('button', { name: 'Take a backup now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Make an export' })).toBeDisabled();
  });

  it('says plainly when the server cannot make copies, and offers no start', async () => {
    serve({
      'GET /api/admin/copies': {
        ...STATE,
        backups: [],
        exports: [],
        unavailable: 'This server was started without its backup settings.',
        restore_command: null,
      },
    });
    wrap(<BackupsPage />);
    expect(
      await screen.findByText('This server was started without its backup settings.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take a backup now' })).toBeDisabled();
  });

  it('an administrator who is not the owner is refused the screen', async () => {
    const sent = serve({
      'GET /api/auth/me': {
        signedIn: true,
        email: 'admin@example.org',
        role: 'admin',
        memberships: [],
        tester: false,
        teamMember: false,
        grantsAccess: true,
        desks: [],
      },
    });
    wrap(
      <StaffOnly needs="owner">
        <BackupsPage />
      </StaffOnly>,
    );
    expect(await screen.findByText(/Only the owner can open this page/)).toBeInTheDocument();
    expect(sent.some((s) => s.url.startsWith('/api/admin/copies'))).toBe(false);
  });
});
