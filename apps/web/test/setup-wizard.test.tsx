/**
 * The setup wizard's screens after the owner: each asks, saves through its
 * owner's own route, and only then moves on. Against a fake server that
 * remembers what was saved, so Back can be seen showing it.
 *
 * The browser test (e2e/identity/access.spec.ts) walks the same screens
 * against the real server; this one checks what is awkward to reach there:
 * a refusal that keeps the screen, Skip, the storage note, and that nothing
 * is written that was not asked for.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupWizard, nameProblem } from '../src/features/identity/SetupWizard.tsx';

const layer = <T,>(v: T) => ({
  logbook: null,
  site: null,
  shipped: v,
  effective: v,
  source: 'shipped',
});

interface Saved {
  method: string;
  path: string;
  body: unknown;
}

/** A deployment mid-setup, with an owner signed in. Records every write. */
function fakeServer({ configured = true, refuseName = false } = {}) {
  const state = {
    name: null as string | null,
    look: { palette: 'flint', theme: 'signal' },
    published: null as boolean | null,
    files: null as boolean | null,
    applied: null as { id: string; at: string } | null,
  };
  const writes: Saved[] = [];
  const editor = () => ({
    look: state.look,
    name: state.name,
    effective_name: state.name ?? 'ReportLog',
    copy: [],
    legal: [],
    home_sections: [],
  });
  const files = () => ({
    configured,
    why_not: configured ? null : 'FILES_STORAGE is not set',
    enabled_stored: state.files,
    enabled: configured && state.files !== false,
    limits: {
      maxImageBytes: layer(1),
      maxVideoBytes: layer(1),
      maxAudioBytes: layer(1),
      maxDocumentBytes: layer(1),
      maxVideoSeconds: layer(1),
      maxDocumentPages: layer(1),
      maxFiles: layer(1),
      maxTotalBytes: layer(1),
      kinds: layer(['photo']),
    },
  });
  const ok = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.split('?')[0] ?? url;
    const method = init?.method ?? 'GET';
    const body: unknown = init?.body ? JSON.parse(init.body as string) : undefined;
    if (method !== 'GET') writes.push({ method, path, body });
    const b = body as Record<string, unknown>;
    switch (`${method} ${path}`) {
      case 'GET /api/auth/me':
        return ok({
          signedIn: true,
          email: 'owner@example.org',
          roles: ['owner'],
          memberships: [],
          grantsAccess: true,
          tester: false,
          teamMember: false,
          desks: [],
          secondFactor: 'done',
          heldRoles: ['owner'],
          stepUpUntil: null,
        });
      case 'GET /api/admin/site':
        return ok(editor());
      case 'PUT /api/admin/site/name':
        if (refuseName)
          return Promise.resolve(
            new Response(
              JSON.stringify({ error: { code: 'refused', message: 'The server said no.' } }),
              { status: 400 },
            ),
          );
        state.name = b.name as string;
        return ok(editor());
      case 'GET /api/admin/templates':
        return ok({
          applied: state.applied,
          templates: [
            {
              id: 'workplace',
              label: 'Workplace or safety incidents',
              description: 'Incidents inside one organisation.',
              sets: ['Publishes nothing', 'Takes files with reports'],
            },
          ],
        });
      case 'POST /api/admin/templates':
        state.applied = { id: b.template as string, at: new Date().toISOString() };
        state.published = false;
        state.files = true;
        return ok({
          applied: b.template,
          logbook: { id: 1, slug: 'workplace', title: 'Workplace' },
        });
      case 'GET /api/admin/moderation/archive':
        return ok({
          published: state.published !== false,
          stored: state.published,
          distribution: false,
          distribution_stored: null,
        });
      case 'PUT /api/admin/moderation/archive':
        state.published = b.published as boolean;
        return ok({
          published: state.published,
          stored: state.published,
          distribution: false,
          distribution_stored: null,
        });
      case 'GET /api/admin/files/settings':
        return ok(files());
      case 'PUT /api/admin/files/settings':
        state.files = b.enabled as boolean;
        return ok(files());
      case 'PUT /api/admin/site/look':
        state.look = { ...state.look, ...(b as object) };
        return ok(editor());
      case 'POST /api/setup/curtain':
        return ok({ ok: true, changed: false });
      default:
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'nope', message: `No ${path}` } }), {
            status: 404,
          }),
        );
    }
  });
  vi.stubGlobal('fetch', fetchMock);
  return { state, writes };
}

function wizard(onFinished = vi.fn(() => Promise.resolve())) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SetupWizard status={{ hasOwner: true, minPassword: 8 }} onFinished={onFinished} />
    </QueryClientProvider>,
  );
  return onFinished;
}

/** On this screen, with what it shows loaded (the heading is drawn before the data arrives). */
async function heading(name: string) {
  await screen.findByRole('heading', { name });
  await vi.waitFor(() => {
    expect(screen.queryByRole('status')).toBeNull();
  });
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the name', () => {
  it('is required here, unlike under Settings', () => {
    expect(nameProblem('')).toBe('Give this archive a name.');
    expect(nameProblem('   ')).toBe('Give this archive a name.');
    expect(nameProblem('""')).toBe('Give this archive a name.');
    expect(nameProblem('Polling "Watch')).toMatch(/Close the quotes/);
    expect(nameProblem('Polling "Watch"')).toBeNull();
  });

  it('a blank one is refused on the screen and nothing is sent', async () => {
    const { writes } = fakeServer();
    wizard();
    await userEvent.click(await screen.findByRole('button', { name: 'Use this and continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Give this archive a name.');
    expect(writes).toEqual([]);
  });

  it('a refusal from the server keeps the screen, with its sentence', async () => {
    fakeServer({ refuseName: true });
    wizard();
    await userEvent.type(await screen.findByLabelText('Its name'), 'Polling Watch');
    await userEvent.click(screen.getByRole('button', { name: 'Use this and continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server said no.');
    expect(screen.getByRole('heading', { name: 'What is this archive called?' })).toBeVisible();
  });
});

describe('walking the screens after the owner', () => {
  it('saves each answer through its own route, in order, and only the last one finishes', async () => {
    const { writes } = fakeServer();
    const onFinished = wizard();

    expect(await screen.findByText('Setting up · step 2 of 7')).toBeVisible();
    await userEvent.type(await screen.findByLabelText('Its name'), 'Polling "Watch"');
    await userEvent.click(screen.getByRole('button', { name: 'Use this and continue' }));

    await heading('What kind of archive is this?');
    const option = screen.getByRole('radio', { name: /Workplace or safety incidents/ });
    // Choosing moves nothing.
    await userEvent.click(option);
    expect(screen.getByRole('heading', { name: 'What kind of archive is this?' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Use this and continue' }));

    // The starting point turned the archive off, and the screen shows it.
    await heading('Does this deployment publish an archive?');
    expect(screen.getByRole('radio', { name: /No, keep everything internal/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Yes, publish approved reports/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Use this and continue' }));

    await heading('Can people attach files to a report?');
    expect(screen.getByRole('radio', { name: /Yes, take files/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Use this and continue' }));

    await heading('How should it look?');
    // The Look screen's chooser and its two previews, starting on what is stored.
    expect(screen.getByText('Previewing Civic.')).toBeInTheDocument();
    expect(document.querySelector('iframe[title="Phone preview"]')).toHaveAttribute(
      'data-palette',
      'flint',
    );
    expect(screen.getByText('Setting up · step 6 of 7')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Palette, the colours'), 'darkroom');
    expect(screen.getByText('Previewing Darkroom with Signal.')).toBeInTheDocument();
    // Choosing repaints the previews only, until it is saved.
    expect(document.documentElement).not.toHaveAttribute('data-palette', 'darkroom');
    await userEvent.click(screen.getByRole('button', { name: 'Use this and continue' }));

    await heading('The site password');
    expect(screen.getByRole('button', { name: 'Finish setting up' })).toBeDisabled();
    expect(onFinished).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('radio', { name: /Keep it/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Finish setting up' }));
    await vi.waitFor(() => {
      expect(onFinished).toHaveBeenCalledTimes(1);
    });

    expect(writes).toEqual([
      { method: 'PUT', path: '/api/admin/site/name', body: { name: 'Polling "Watch"' } },
      { method: 'POST', path: '/api/admin/templates', body: { template: 'workplace' } },
      { method: 'PUT', path: '/api/admin/moderation/archive', body: { published: true } },
      { method: 'PUT', path: '/api/admin/files/settings', body: { enabled: true } },
      {
        method: 'PUT',
        path: '/api/admin/site/look',
        body: { palette: 'darkroom', theme: 'signal' },
      },
      { method: 'POST', path: '/api/setup/curtain', body: { decision: 'keep' } },
    ]);
    // The look is painted once it is saved.
    expect(document.documentElement).toHaveAttribute('data-palette', 'darkroom');
  });

  it('Back shows what was saved, and Skip moves on without writing anything', async () => {
    const { writes } = fakeServer();
    wizard();
    await userEvent.type(await screen.findByLabelText('Its name'), 'Kept');
    await userEvent.click(screen.getByRole('button', { name: 'Use this and continue' }));
    await heading('What kind of archive is this?');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByLabelText('Its name')).toHaveValue('Kept');
    await userEvent.click(screen.getByRole('button', { name: 'Use this and continue' }));
    await heading('What kind of archive is this?');
    await userEvent.click(screen.getByRole('button', { name: /^Skip/ }));
    await heading('Does this deployment publish an archive?');
    // Nobody chose, which is on, and the screen says so by arriving on yes.
    expect(screen.getByRole('radio', { name: /Yes, publish approved reports/ })).toBeChecked();
    expect(writes.map((w) => w.path)).toEqual(['/api/admin/site/name', '/api/admin/site/name']);
  });

  it('the first screen after the owner has no Back: the owner step cannot be run again', async () => {
    fakeServer();
    wizard();
    await screen.findByLabelText('Its name');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});

describe('files, with nowhere to keep them yet', () => {
  it('says so, and still records the answer', async () => {
    const { writes } = fakeServer({ configured: false });
    wizard();
    await userEvent.type(await screen.findByLabelText('Its name'), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Use this and continue' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Skip/ }));
    await heading('Does this deployment publish an archive?');
    await userEvent.click(screen.getByRole('button', { name: 'Use this and continue' }));
    await heading('Can people attach files to a report?');
    expect(
      await screen.findByText(/nowhere to keep files yet \(FILES_STORAGE is not set\)/),
    ).toBeVisible();
    const choices = screen.getByRole('radiogroup', {
      name: 'Can people attach files to a report?',
    });
    await userEvent.click(within(choices).getByRole('radio', { name: /Yes, take files/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Use this and continue' }));
    await heading('How should it look?');
    expect(writes.at(-1)).toEqual({
      method: 'PUT',
      path: '/api/admin/files/settings',
      body: { enabled: true },
    });
  });
});
