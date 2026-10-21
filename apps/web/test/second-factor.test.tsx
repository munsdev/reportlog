/**
 * Two-factor login on screen (plan E, decision E3).
 *
 * THE PROMISES UNDER TEST:
 *   - somebody holding a role whose session has not proved a second factor
 *     is shown the way to it in place of the staff screen: setting one up
 *     if they have none, proving it if they have;
 *   - somebody without the role is still refused, not offered a factor;
 *   - the QR code is drawn on the page, from the server's own otpauth
 *     address, with the key also written out for typing;
 *   - the recovery codes stay on screen until the person says they kept
 *     them, though the server has let them in;
 *   - a call the server refuses with `step_up_required` asks for the factor
 *     and is made again, once, and a closed dialog leaves it refused.
 */
import { setSystemRole } from '@reportlog/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaffOnly } from '../src/features/identity/StaffOnly.tsx';
import { StepUpHost } from '../src/features/identity/StepUp.tsx';
import { ApiRequestError, call, setStepUpHandler } from '../src/lib/api.ts';

const me = (over: Record<string, unknown>) => ({
  signedIn: true,
  email: 'mod@example.org',
  role: 'user',
  memberships: [],
  grantsAccess: false,
  tester: false,
  teamMember: false,
  desks: [],
  secondFactor: 'set-up',
  heldRole: 'moderator',
  stepUpUntil: null,
  ...over,
});

const STATUS = {
  state: 'set-up',
  totpAvailable: true,
  totp: false,
  passkeys: [],
  recoveryLeft: 0,
  lockedUntil: null,
  stepUpUntil: null,
};

// A fixed answer, or a function of the body sent.
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
      const out =
        typeof answer === 'function'
          ? (answer as (b: unknown) => { status: number; body: unknown })(body)
          : { status: 200, body: answer };
      return Promise.resolve(new Response(JSON.stringify(out.body), { status: out.status }));
    }),
  );
  return sent;
}

function wrap(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ['/moderate'] }),
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
  setStepUpHandler(null);
});

describe('a staff screen, for a role holder without a second factor', () => {
  it('with none set up: the way to set one up, not the screen and not a refusal', async () => {
    serve({ 'GET /api/auth/me': me({}), 'GET /api/auth/second-factor': STATUS });
    wrap(
      <StaffOnly needs="moderator">
        <p>The queue</p>
      </StaffOnly>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Set up a second way to sign in' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('The queue')).not.toBeInTheDocument();
    expect(screen.queryByText('Not for this account')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use an authenticator app' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use a passkey' })).toBeInTheDocument();
  });

  it('with one set up: asked to prove it', async () => {
    serve({
      'GET /api/auth/me': me({ secondFactor: 'verify' }),
      'GET /api/auth/second-factor': { ...STATUS, state: 'verify', totp: true },
    });
    wrap(
      <StaffOnly needs="moderator">
        <p>The queue</p>
      </StaffOnly>,
    );
    expect(await screen.findByRole('heading', { name: 'One more step' })).toBeInTheDocument();
    expect(screen.getByLabelText('Code from your authenticator app')).toBeInTheDocument();
    expect(screen.queryByText('The queue')).not.toBeInTheDocument();
  });

  it('without the role at all: refused, and offered nothing', async () => {
    serve({ 'GET /api/auth/me': me({ heldRole: 'journalist' }) });
    wrap(
      <StaffOnly needs="moderator">
        <p>The queue</p>
      </StaffOnly>,
    );
    expect(await screen.findByText('Not for this account')).toBeInTheDocument();
    expect(screen.queryByText(/second way to sign in/)).not.toBeInTheDocument();
  });

  it('draws the QR code itself, writes the key out, and keeps the recovery codes up until kept', async () => {
    const codes = Array.from({ length: 10 }, (_, i) => `AAAA-BBBB-CCCC-000${String(i)}`);
    let now = me({});
    const sent = serve({
      'GET /api/auth/me': () => ({ status: 200, body: now }),
      'GET /api/auth/second-factor': STATUS,
      'POST /api/auth/second-factor/totp/begin': {
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        uri: 'otpauth://totp/reports.example.org:mod%40example.org?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=reports.example.org&algorithm=SHA1&digits=6&period=30',
      },
      'POST /api/auth/second-factor/totp/confirm': () => {
        now = me({ role: 'moderator', secondFactor: 'done' });
        return { status: 200, body: { recoveryCodes: codes } };
      },
    });
    wrap(
      <StaffOnly needs="moderator">
        <p>The queue</p>
      </StaffOnly>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Use an authenticator app' }));
    const qr = await screen.findByRole('img', {
      name: 'QR code to add this site to your authenticator app',
    });
    expect(qr.tagName.toLowerCase()).toBe('svg');
    expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M\d+,\d+h1v1h-1z/);
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    await user.type(screen.getByLabelText('The six-digit code the app shows now'), '123456');
    await user.click(screen.getByRole('button', { name: 'Use this app' }));
    expect(await screen.findByRole('heading', { name: 'Your recovery codes' })).toBeInTheDocument();
    for (const c of codes) expect(screen.getByText(c)).toBeInTheDocument();
    // The server has let them in by now; the codes stay until they say so.
    await waitFor(() => {
      expect(sent.filter((s) => s.url === '/api/auth/me').length).toBeGreaterThan(1);
    });
    expect(screen.queryByText('The queue')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I have kept them' }));
    expect(await screen.findByText('The queue')).toBeInTheDocument();
    expect(sent.find((s) => s.url.endsWith('/totp/confirm'))?.body).toEqual({ code: '123456' });
    // Nothing was fetched from anywhere but this site.
    expect(sent.every((s) => s.url.startsWith('/api/'))).toBe(true);
  });
});

describe('a step-up', () => {
  it('a refused call asks, then is made again once', async () => {
    let fresh = false;
    const sent = serve({
      'POST /api/access/system-role': () =>
        fresh
          ? { status: 200, body: { ok: true, unchanged: true } }
          : {
              status: 403,
              body: { error: { code: 'step_up_required', message: 'Confirm it is you first.' } },
            },
    });
    const asked = vi.fn(() => {
      fresh = true;
      return Promise.resolve(true);
    });
    setStepUpHandler(asked);
    const out = await call(setSystemRole, { body: { email: 'a@example.org', role: 'moderator' } });
    expect(out).toEqual({ ok: true, unchanged: true });
    expect(asked).toHaveBeenCalledTimes(1);
    expect(sent.filter((s) => s.url === '/api/access/system-role')).toHaveLength(2);
  });

  it('closed without proving it: the refusal stands, and the call is not made again', async () => {
    const sent = serve({
      'POST /api/access/system-role': () => ({
        status: 403,
        body: { error: { code: 'step_up_required', message: 'Confirm it is you first.' } },
      }),
    });
    setStepUpHandler(() => Promise.resolve(false));
    await expect(
      call(setSystemRole, { body: { email: 'a@example.org', role: 'moderator' } }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(sent).toHaveLength(1);
  });

  it('the dialog asks for the factor, and proving it lets the call through', async () => {
    let fresh = false;
    serve({
      'GET /api/auth/second-factor': { ...STATUS, state: 'done', totp: true },
      'POST /api/auth/second-factor/verify': () => {
        fresh = true;
        return {
          status: 200,
          body: me({
            role: 'moderator',
            secondFactor: 'done',
            stepUpUntil: new Date().toISOString(),
          }),
        };
      },
      'GET /api/auth/me': me({ role: 'moderator', secondFactor: 'done' }),
      'POST /api/access/system-role': () =>
        fresh
          ? { status: 200, body: { ok: true, unchanged: true } }
          : {
              status: 403,
              body: { error: { code: 'step_up_required', message: 'Confirm it is you first.' } },
            },
    });
    wrap(
      <>
        <p>Ready</p>
        <StepUpHost />
      </>,
    );
    const user = userEvent.setup();
    // Mounted, so it has told the API client it is the one who asks.
    await screen.findByText('Ready');
    const pending = call(setSystemRole, { body: { email: 'a@example.org', role: 'moderator' } });
    expect(await screen.findByRole('dialog', { name: 'Confirm it is you' })).toBeInTheDocument();
    await user.type(await screen.findByLabelText('Code from your authenticator app'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(pending).resolves.toEqual({ ok: true, unchanged: true });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
