/**
 * The account screens and the logbook list as redesigned (account.md §02,
 * §03, §05, §07; settings-and-admin.md §08).
 *
 * THE PROMISES UNDER TEST:
 *   - signing in: one panel, its content replaced by the code step, the
 *     code field set as a code;
 *   - "Not you? Start again" signs out and goes back to the address;
 *   - the recovery codes can be copied and printed from the page, and stay
 *     until "I have kept them";
 *   - Signing in (the security page): each panel says what is set before it
 *     is opened, one is open at a time, the last way to sign in says why it
 *     cannot be removed, and removing a passkey asks first;
 *   - My reports: a state chip per report, never teal, "Declined" not
 *     serious;
 *   - the logbook list: making one is behind a button, and an empty site
 *     says so as an empty state.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LogbookList } from '../src/features/builder/LogbookList.tsx';
import { stateChip } from '../src/features/form/MyReports.tsx';
import { RecoveryCodes, SecondFactorGate } from '../src/features/identity/secondFactor.tsx';
import { SecurityPage } from '../src/features/identity/SecurityPage.tsx';
import { SignInForm } from '../src/features/identity/SignInForm.tsx';

const me = (over: Record<string, unknown>) => ({
  signedIn: true,
  email: 'mod@example.org',
  role: 'moderator',
  memberships: [],
  grantsAccess: false,
  tester: false,
  teamMember: false,
  desks: [],
  secondFactor: 'done',
  heldRole: 'moderator',
  stepUpUntil: null,
  ...over,
});

const STATUS = {
  state: 'done',
  totpAvailable: true,
  totp: false,
  passkeys: [] as { id: number; name: string; created_at: string; last_used_at: string | null }[],
  recoveryLeft: 7,
  lockedUntil: null,
  stepUpUntil: null,
};

type Answer = unknown;

function serve(answers: Record<string, Answer>) {
  const sent: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      sent.push({ method, url, body });
      const answer = answers[`${method} ${url.split('?')[0] ?? ''}`];
      if (answer === undefined) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'nope', message: 'No.' } }), {
            status: 404,
          }),
        );
      }
      const out = typeof answer === 'function' ? (answer as () => Answer)() : answer;
      return Promise.resolve(new Response(JSON.stringify(out), { status: 200 }));
    }),
  );
  return sent;
}

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signing in', () => {
  it('replaces the address with the code in the same panel, and sets the code as a code', async () => {
    serve({ 'POST /api/auth/code': { ok: true } });
    const user = userEvent.setup();
    wrap(<SignInForm onSignedIn={() => undefined} />);
    await user.type(await screen.findByLabelText('Your email address'), 'you@example.org');
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    const code = await screen.findByLabelText('The code from the email');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code.className).toMatch(/font-mono/);
    expect(screen.getByText('you@example.org')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use a different address' }));
    // The address is kept, to correct rather than retype.
    expect(screen.getByLabelText('Your email address')).toHaveValue('you@example.org');
  });

  it('the second step says who is signed in, and "Start again" signs out', async () => {
    let now: unknown = me({ role: 'user', secondFactor: 'verify' });
    const sent = serve({
      'GET /api/auth/me': () => now,
      'GET /api/auth/second-factor': { ...STATUS, state: 'verify', totp: true },
      'POST /api/auth/sign-out': () => {
        now = { signedIn: false };
        return { ok: true };
      },
    });
    const user = userEvent.setup();
    wrap(
      <SecondFactorGate>
        <p>Behind the role</p>
      </SecondFactorGate>,
    );
    expect(await screen.findByRole('heading', { name: 'One more step' })).toBeInTheDocument();
    expect(screen.getByText('Sign in · step 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByText('mod@example.org')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start again' }));
    await waitFor(() => {
      expect(sent.some((s) => s.method === 'POST' && s.url === '/api/auth/sign-out')).toBe(true);
    });
  });
});

describe('the recovery codes', () => {
  it('copies them, offers a file and printing, and stays until kept', async () => {
    serve({});
    // After setup: user-event puts a clipboard of its own on navigator.
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const kept = vi.fn();
    const codes = ['AAAA-BBBB-CCCC-0001', 'AAAA-BBBB-CCCC-0002'];
    wrap(<RecoveryCodes codes={codes} onKept={kept} />);
    await user.click(await screen.findByRole('button', { name: 'Copy them' }));
    expect(writeText).toHaveBeenCalledWith(codes.join('\n'));
    expect(await screen.findByText('Copied. Paste them somewhere safe.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download as a text file' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Print them' }));
    expect(print).toHaveBeenCalledTimes(1);
    // What printing shows: the codes, marked as the only thing to print.
    expect(screen.getByText(codes[0] ?? '').closest('[data-print-only]')).not.toBeNull();
    expect(kept).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'I have kept them' }));
    expect(kept).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });
});

describe('the security page', () => {
  const passkey = {
    id: 3,
    name: 'Work laptop',
    created_at: '2026-10-03T10:00:00.000Z',
    last_used_at: '2026-10-20T10:00:00.000Z',
  };

  it('says what is set before anything is opened, one panel at a time', async () => {
    serve({
      'GET /api/auth/me': me({}),
      'GET /api/auth/second-factor': { ...STATUS, totp: true, passkeys: [passkey] },
    });
    const user = userEvent.setup();
    wrap(<SecurityPage />);
    const app = await screen.findByRole('region', { name: 'Authenticator app' });
    expect(app).toHaveTextContent('Set up');
    expect(screen.getByRole('region', { name: 'Passkeys' })).toHaveTextContent('1 passkey');
    expect(screen.getByRole('region', { name: 'Recovery codes' })).toHaveTextContent(
      '7 recovery codes left.',
    );
    expect(screen.queryByText('Work laptop')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Change Passkeys' }));
    expect(screen.getByText('Work laptop')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change Recovery codes' }));
    // Opening another closes the first.
    expect(screen.queryByText('Work laptop')).toBeNull();
    expect(screen.getByRole('button', { name: 'Make new recovery codes' })).toBeInTheDocument();
  });

  it('asks before removing a passkey, and sends nothing until asked', async () => {
    const sent = serve({
      'GET /api/auth/me': me({}),
      'GET /api/auth/second-factor': { ...STATUS, totp: true, passkeys: [passkey] },
      'DELETE /api/auth/second-factor/passkeys/3': { ok: true },
    });
    const user = userEvent.setup();
    wrap(<SecurityPage />);
    await user.click(await screen.findByRole('button', { name: 'Change Passkeys' }));
    await user.click(screen.getByRole('button', { name: 'Remove Work laptop' }));
    const ask = await screen.findByRole('dialog', { name: 'Remove this passkey?' });
    expect(within(ask).getByText(/You can add it again later/)).toBeInTheDocument();
    expect(sent.filter((s) => s.method !== 'GET')).toEqual([]);
    await user.click(within(ask).getByRole('button', { name: 'Keep it' }));
    expect(sent.filter((s) => s.method !== 'GET')).toEqual([]);
  });

  it('the only way to sign in cannot be removed, and says why', async () => {
    serve({
      'GET /api/auth/me': me({}),
      'GET /api/auth/second-factor': { ...STATUS, passkeys: [passkey] },
    });
    const user = userEvent.setup();
    wrap(<SecurityPage />);
    await user.click(await screen.findByRole('button', { name: 'Change Passkeys' }));
    expect(screen.queryByRole('button', { name: 'Remove Work laptop' })).toBeNull();
    expect(
      screen.getByText(
        'This is your only way to sign in, so it cannot be removed. Add another first.',
      ),
    ).toBeInTheDocument();
  });
});

describe('my reports', () => {
  const base = {
    thread_id: 't',
    public_ref: 'RL-7K2M-4QXD',
    logbook_slug: 'polls',
    logbook_title: 'Polls',
    received_at: '2026-10-20T10:00:00.000Z',
    first_received_at: '2026-10-20T10:00:00.000Z',
    versions: 1,
    answers: {},
    may_publish: true,
    withdrawn: false,
    moderation_status: 'pending',
    permissions: { contact_passing: false, attachment_publication: false, evidence_request: false },
  };

  it('a chip per state, never teal, and a declined report is not marked serious', () => {
    expect(stateChip(base)).toEqual({ tone: 'open', label: 'Waiting' });
    expect(stateChip({ ...base, moderation_status: 'valid' })).toEqual({
      tone: 'tag',
      label: 'Public',
    });
    expect(stateChip({ ...base, moderation_status: 'valid', may_publish: false })).toEqual({
      tone: 'tag',
      label: 'Not published',
    });
    expect(stateChip({ ...base, moderation_status: 'invalid' })).toEqual({
      tone: 'tag',
      label: 'Declined',
    });
    expect(stateChip({ ...base, withdrawn: true })).toEqual({ tone: 'tag', label: 'Withdrawn' });
  });
});

describe('the logbook list', () => {
  it('an empty site says so, and making one opens only when asked', async () => {
    serve({
      'GET /api/admin/logbooks': { logbooks: [] },
      'GET /api/admin/logbooks/starting-points': { starting_points: [] },
    });
    const user = userEvent.setup();
    wrap(<LogbookList />);
    expect(await screen.findByText('No logbooks yet')).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).toBeNull();
    const [make] = screen.getAllByRole('button', { name: 'Make a logbook' });
    if (!make) throw new Error('no Make a logbook button');
    await user.click(make);
    expect(await screen.findByRole('region', { name: 'Make a logbook' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Start from nothing' })).toBeChecked();
    // The site-wide switch is not here any more; the page points to it.
    expect(screen.getByRole('link', { name: 'Site settings, Accepting reports' })).toHaveAttribute(
      'href',
      '/settings',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', { name: 'Make a logbook' })).toBeNull();
  });
});
