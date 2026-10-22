/**
 * Stage 5 follow-up (D2): the staff screens rebuilt to their spec sections.
 *
 * THE PROMISES UNDER TEST:
 *   - who opened protected data is a page of its own: every opening with
 *     who, when, which report and the reason in full, a count line, and
 *     nothing that filters a row out;
 *   - the journalist queue asks before rejecting, because rejecting deletes
 *     what the person sent; approving does not ask;
 *   - the front page editor draws the button stack as a phone shows it and
 *     follows a move before anything is saved;
 *   - feedback names the screen it came from by the menu's name, and the
 *     tester can say it is not about that page;
 *   - "Who granted what" says each change as one sentence.
 */
import type { AccessRequestView, HomeButtonsAdmin } from '@reportlog/contracts';
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
import { HomeButtonsEditor } from '../src/features/builder/HomeButtonsEditor.tsx';
import { pageNameFor } from '../src/features/feedback/words.tsx';
import { auditSentence } from '../src/features/identity/AuditPage.tsx';
import { OwnerQueuePage } from '../src/features/journalists/OwnerQueue.tsx';
import { AccessLogPage } from '../src/features/moderation/AccessLog.tsx';

interface Sent {
  method: string;
  url: string;
}

function serve(answers: Record<string, unknown>) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? 'GET';
      sent.push({ method, url });
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

function wrap(node: ReactNode, at = '/') {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: [at] }),
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

describe('who opened protected data', () => {
  it('lists every opening with who, when, which report and the reason, under a count line', async () => {
    const sent = serve({
      'GET /api/admin/moderation/access-log': {
        months: 120,
        entries: [
          {
            id: 'c-2',
            staff_email: 'mod@example.org',
            kind: 'contact',
            reason: 'To ask whether the photo can be published.',
            accessed_at: '2026-10-21T09:30:00.000Z',
            thread_id: '00000000-0000-4000-8000-000000000001',
            public_ref: 'RL-7K2M',
            attachment_id: null,
            logbook: null,
          },
          {
            id: 'a-1',
            staff_email: 'admin@example.org',
            kind: 'audit_log',
            reason: null,
            accessed_at: '2026-10-20T08:00:00.000Z',
            thread_id: null,
            public_ref: null,
            attachment_id: null,
            logbook: null,
          },
          {
            id: 'f-1',
            staff_email: 'admin@example.org',
            kind: 'file_original',
            reason: 'Checking the face is blurred.',
            accessed_at: '2026-10-01T12:00:00.000Z',
            thread_id: '00000000-0000-4000-8000-000000000002',
            public_ref: 'RL-4QQ1',
            attachment_id: 12,
            logbook: null,
          },
        ],
      },
    });
    wrap(<AccessLogPage />, '/who-opened-what');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Who opened protected data' }),
    ).toBeInTheDocument();
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    // A header row and two openings: a read of the log itself is not listed back.
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('2026-10-21 09:30');
    expect(rows[1]).toHaveTextContent('mod@example.org');
    expect(rows[1]).toHaveTextContent('RL-7K2M');
    expect(rows[1]).toHaveTextContent('To ask whether the photo can be published.');
    expect(rows[2]).toHaveTextContent('Opened a file’s original (file 12)');
    expect(screen.getByText(/^2 openings · since/)).toBeInTheDocument();
    // The longest span the server answers, and nothing on the page narrows it.
    expect(sent.find((s) => s.url.includes('access-log'))?.url).toContain('months=120');
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

const REQUEST: AccessRequestView = {
  id: 4,
  name: 'Pat Reporter',
  address: 'p***@example.org',
  outlet: 'Desk Daily',
  role: 'reporter',
  about: 'Pat, covering Vermont for Desk Daily.',
  links: ['https://deskdaily.example.org/by/pat'],
  press_card_number: 'PC-777',
  press_card_issuer: null,
  states: ['Arizona'],
  status: 'pending',
  requested_at: '2026-10-21T09:00:00.000Z',
  decided_at: null,
  decided_by: null,
  revoked_at: null,
};

describe('the journalist queue', () => {
  it('asks before rejecting, and shows the links as text', async () => {
    const user = userEvent.setup();
    const sent = serve({
      'GET /api/owner/journalists': { requests: [REQUEST] },
      'POST /api/owner/journalists/4/reject': { ok: true },
    });
    wrap(<OwnerQueuePage />, '/access/journalists');
    const card = await screen.findByRole('article', { name: 'Request from Pat Reporter' });
    expect(within(card).getByText('https://deskdaily.example.org/by/pat').tagName).toBe('LI');
    expect(within(card).queryByRole('link')).toBeNull();

    await user.click(within(card).getByRole('button', { name: 'Reject and delete' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Reject the request from Pat Reporter?',
    });
    expect(dialog).toHaveTextContent('They stay on the alert list');
    expect(sent.filter((s) => s.method === 'POST')).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Keep the request' }));
    expect(sent.filter((s) => s.method === 'POST')).toEqual([]);
  });
});

const POLLING = {
  kind: 'logbook' as const,
  ref: 'polling',
  label: 'Polling day',
  href: '/file/polling',
  action: null,
  blurb: null,
  help: null,
};
const MAIL = { ...POLLING, ref: 'mail', label: 'Mail ballots', href: '/file/mail' };
const HOME: HomeButtonsAdmin = {
  buttons: [
    { ...POLLING, title: 'Polling day', accent: true },
    { ...MAIL, title: 'Mail ballots', accent: false },
  ],
  stored: null,
  available: { logbooks: [POLLING, MAIL], lists: [], builtins: [] },
};

describe('the front page editor', () => {
  it('draws the buttons as a phone shows them, and follows a move before it is saved', async () => {
    const user = userEvent.setup();
    serve({ 'GET /api/admin/home-buttons': HOME });
    wrap(<HomeButtonsEditor />, '/logbooks/front-page');
    const preview = (await screen.findByText('On a phone, as it will look')).closest('figure');
    if (!preview) throw new Error('no preview');
    const stack = () => [...preview.querySelectorAll('div > span')].map((n) => n.textContent);
    expect(stack()).toEqual(['Polling day', 'Mail ballots']);
    await user.click(screen.getByRole('button', { name: 'Move up: “Mail ballots”' }));
    expect(stack()).toEqual(['Mail ballots', 'Polling day']);
    const [first] = screen.getAllByLabelText('Button wording (optional)');
    if (!first) throw new Error('no wording box');
    await user.type(first, 'Mail');
    expect(stack()[0]).toBe('Mail');
  });
});

describe('words', () => {
  it('names the screen feedback came from by the menu’s name', () => {
    expect(pageNameFor('/(staff)/settings/')).toBe('Site settings');
    expect(pageNameFor('/(staff)/moderate/')).toBe('Queue');
    expect(pageNameFor('/(staff)/moderate/$threadId')).toBe('Queue');
    expect(pageNameFor('/board/')).toBeNull();
  });

  it('says each change of role as one sentence', () => {
    const row = {
      actor_email: 'owner@example.org',
      subject_email: 'mod@example.org',
      axis: 'system',
      detail: 'moderator',
      organization: null,
      created_at: '2026-10-21T09:00:00.000Z',
    };
    expect(auditSentence({ ...row, action: 'grant' })).toBe(
      'owner@example.org gave mod@example.org: moderator',
    );
    expect(auditSentence({ ...row, action: 'revoke', organization: 'Harbour' })).toBe(
      'owner@example.org took from mod@example.org: moderator (Harbour)',
    );
  });
});
