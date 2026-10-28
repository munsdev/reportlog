/**
 * People (/people, features/people/PeoplePage.tsx): one table for everybody
 * with a role, a flag or an organization, and one place to change a person.
 * What may be offered is @reportlog/access's to say, and a save sends one of
 * the existing calls per thing changed, and nothing else.
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
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeoplePage } from '../src/features/people/PeoplePage.tsx';

interface Sent {
  method: string;
  url: string;
  body: unknown;
}

const ME = (role: string) => ({
  signedIn: true,
  email: `${role}@example.org`,
  roles: [role],
  memberships: [],
  grantsAccess: true,
  tester: false,
  teamMember: false,
  desks: [],
  secondFactor: 'done',
  heldRoles: [role],
  stepUpUntil: null,
});

const person = (email: string, over: Record<string, unknown> = {}) => ({
  email,
  roles: [],
  tester: false,
  teamMember: false,
  desks: [],
  organizations: [],
  filedByThem: 0,
  filedForTheirOrganizations: 0,
  lastStaffAction: null,
  ...over,
});

const ROSTER = {
  days: 30,
  people: [
    person('owner@example.org', { roles: ['owner'] }),
    person('mod@example.org', { roles: ['moderator'], lastStaffAction: '2026-10-27T10:00:00Z' }),
    person('tess@example.org', { tester: true }),
    person('lee@example.org', {
      organizations: [{ name: 'Eastside Mutual Aid', role: 'manager' }],
      filedByThem: 23,
    }),
  ],
};

function serve(me: unknown) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? 'GET';
      const path = url.split('?')[0] ?? '';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      sent.push({ method, url: path, body });
      const answers: Record<string, unknown> = {
        'GET /api/auth/me': me,
        'GET /api/access/roster': ROSTER,
        'GET /api/access/audit': {
          entries: [
            {
              actor_email: 'owner@example.org',
              subject_email: 'mod@example.org',
              axis: 'system',
              action: 'grant',
              detail: 'moderator',
              organization: null,
              created_at: '2026-09-02T09:00:00Z',
            },
          ],
        },
        'POST /api/access/system-role': { ok: true, unchanged: false, roles: [] },
        'POST /api/admin/testers': { ok: true, unchanged: false },
      };
      const key = `${method} ${path}`;
      return Promise.resolve(
        key in answers
          ? new Response(JSON.stringify(answers[key]), { status: 200 })
          : new Response(JSON.stringify({ error: { code: 'nope', message: 'No.' } }), {
              status: 404,
            }),
      );
    }),
  );
  return sent;
}

function wrap(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ['/people'] }),
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

const writes = (sent: Sent[]) => sent.filter((s) => s.method !== 'GET');

/** The address in each body row of the kit's table (mockup/Tbl.tsx draws rows, not a <table>). */
function addresses(): string[] {
  return [...document.querySelectorAll('.tbl .row:not(.head)')].map(
    (r) => r.firstElementChild?.textContent ?? '',
  );
}

describe('People', () => {
  it('lists everybody once, by address, with what they hold, and narrows by kind', async () => {
    serve(ME('admin'));
    wrap(<PeoplePage />);
    expect(await screen.findByText('Eastside Mutual Aid (manager)')).toBeVisible();
    expect(addresses()).toEqual([
      'lee@example.org',
      'mod@example.org',
      'owner@example.org',
      'tess@example.org',
    ]);
    await userEvent.setup().click(screen.getByRole('button', { name: /^Testers/ }));
    expect(addresses()).toEqual(['tess@example.org']);
  });

  it('offers an Access Manager the moderator role and the flags, never administrator', async () => {
    const sent = serve(ME('access_manager'));
    wrap(<PeoplePage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change mod@example.org' }));
    const dialog = await screen.findByRole('dialog', { name: 'mod@example.org' });
    expect(within(dialog).getByRole('checkbox', { name: 'Moderator' })).toBeEnabled();
    expect(within(dialog).getByRole('checkbox', { name: 'Access Manager' })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: 'Administrator' })).toBeDisabled();
    // Their own line in the record is there, beside what they hold.
    expect(within(dialog).getByText(/gave mod@example\.org/i)).toBeVisible();
    // Nothing changed: nothing to save.
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.click(within(dialog).getByRole('checkbox', { name: 'Moderator' }));
    await user.click(within(dialog).getByRole('checkbox', { name: /^Tester/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(writes(sent)).toEqual([
      {
        method: 'POST',
        url: '/api/access/system-role',
        body: { email: 'mod@example.org', role: 'moderator', action: 'revoke' },
      },
      {
        method: 'POST',
        url: '/api/admin/testers',
        body: { email: 'mod@example.org', tester: true },
      },
    ]);
  });

  it('never offers the owner’s roles, and says where the seat moves instead', async () => {
    const sent = serve(ME('admin'));
    wrap(<PeoplePage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change owner@example.org' }));
    const dialog = await screen.findByRole('dialog', { name: 'owner@example.org' });
    expect(within(dialog).queryByRole('checkbox', { name: 'Administrator' })).toBeNull();
    expect(within(dialog).getByText(/moves only by a hand-over/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(writes(sent)).toEqual([]);
  });

  it('gives somebody new access by address, sending only what was ticked', async () => {
    const sent = serve(ME('owner'));
    wrap(<PeoplePage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Give somebody access' }));
    const dialog = await screen.findByRole('dialog', { name: 'Give somebody access' });
    await user.type(within(dialog).getByLabelText(/Their email address/), 'New@Example.org');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Administrator' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(writes(sent)).toHaveLength(1);
    });
    expect(writes(sent)[0]).toEqual({
      method: 'POST',
      url: '/api/access/system-role',
      body: { email: 'new@example.org', role: 'admin', action: 'grant' },
    });
  });
});
