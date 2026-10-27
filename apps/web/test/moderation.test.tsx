/**
 * The moderation screens (docs/design/screens/moderation.md, stage 5).
 *
 * THE PROMISES UNDER TEST:
 *   - search is applied on Enter, never on each keystroke (decision 59);
 *   - the status buttons carry the server's counts, one pressed at a time;
 *   - "Decide here" in the queue and the report page's Decide panel send the
 *     same call with the same body, so they record the same decision row;
 *   - the reason the reporter is told appears under Decline, after the
 *     choice, and nothing is sent without a note for the record;
 *   - a bulk decline says nobody is emailed and sends nothing without one
 *     reason from the fixed list;
 *   - "Who filed it" sends nothing until there is a written reason, so
 *     closing it without one writes nothing and shows nothing.
 */
import type { QueueItem } from '@reportlog/contracts';
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
import { ItemPage } from '../src/features/moderation/Item.tsx';
import { QueuePage, filterWords } from '../src/features/moderation/Queue.tsx';

const THREAD = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

const REPORT: QueueItem = {
  thread_id: THREAD,
  public_ref: 'RL-4HT8-0QNC',
  received_at: '2026-11-03T14:20:00.000Z',
  logbook_slug: 'demo',
  logbook_title: 'Election incidents',
  answers: { what: 'Polling place moved.' },
  may_publish: true,
  moderation_status: 'pending',
  withdrawn: false,
  reporter_withdrew: false,
  versions: 1,
  filed_via: null,
  intake_method: null,
  needs_review: false,
  review_terms: [],
  notes_enabled: false,
  has_note: false,
  has_undecided_written: false,
  has_contact: true,
  file_count: 0,
  published_files: 0,
  files_permitted: false,
  public: false,
  severity: null,
  corroboration: 0,
  incident_size: 0,
  threat_open: false,
  origin: 'open_form',
  organization_id: null,
  answer_set: 'a'.repeat(32),
};
const SECOND: QueueItem = { ...REPORT, thread_id: OTHER, public_ref: 'RL-7K2M-4QXD' };

const QUEUE = {
  reports: [REPORT, SECOND],
  open_flags: 2,
  archive_published: true,
  counts: { all: 31, pending: 7, valid: 19, invalid: 3, unknown: 1, withdrawn: 1 },
  total: 7,
  page: 1,
  pages: 1,
};

const ITEM = {
  report: REPORT,
  history: [],
  assessment: { severity: null, incident_id: null, linked: [], published_accounts: 0 },
};

interface Sent {
  method: string;
  url: string;
  body: unknown;
}

/** A fetch answering by method and path, recording every call. Unknown calls get a 404. */
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

function wrap(node: ReactNode, at = '/moderate') {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: [at] }),
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const queueReads = (sent: Sent[]) =>
  sent.filter((s) => s.method === 'GET' && s.url.startsWith('/api/moderation/reports?')).length;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the queue', () => {
  it('shows a count on each status button, with Waiting pressed', async () => {
    serve({ 'GET /api/moderation/reports': QUEUE });
    wrap(<QueuePage search={{}} />);
    const group = await screen.findByRole('group', { name: 'Show reports that are' });
    const waiting = within(group).getByRole('button', { name: /^Waiting/ });
    expect(waiting).toHaveAttribute('aria-pressed', 'true');
    expect(await within(group).findByText('7 waiting')).toBeInTheDocument();
    expect(within(group).getByText('19 approved')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: /^Approved/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // Second read is not a status: it stands outside the group.
    expect(within(group).queryByRole('button', { name: /second read/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^Only second reads/ })).toBeInTheDocument();
  });

  it('searches on Enter, never on each keystroke (decision 59)', async () => {
    const sent = serve({ 'GET /api/moderation/reports': QUEUE });
    const router = wrap(<QueuePage search={{}} />);
    const user = userEvent.setup();
    const field = await screen.findByLabelText('Search words or a reference');
    await screen.findByRole('list', { name: 'Reports' });
    const before = queueReads(sent);
    await user.type(field, 'hall');
    expect(queueReads(sent)).toBe(before);
    expect(router.state.location.search).not.toHaveProperty('q');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ q: 'hall' });
    });
  });

  it('names every filter in force, in words', () => {
    expect(
      filterWords({ q: 'hall', flagged: true, severity: 'serious', lane: 'organization' }),
    ).toEqual([
      'matching “hall”',
      'only second reads',
      'rated: Serious',
      'filed by an organization',
    ]);
  });
});

describe('deciding', () => {
  const decided = { ok: true, notice: 'none' };

  async function decideIn(scope: HTMLElement, note: string) {
    const user = userEvent.setup();
    await user.click(within(scope).getByRole('radio', { name: 'Approve' }));
    await user.type(within(scope).getByLabelText(/^Note for the record \(never sent\)/), note);
    await user.click(within(scope).getByRole('button', { name: 'Record the decision' }));
  }

  it('in the queue and on the report page sends the same call with the same body', async () => {
    const sent = serve({
      'GET /api/moderation/reports': QUEUE,
      [`POST /api/moderation/reports/${THREAD}/decision`]: decided,
      [`GET /api/moderation/reports/${THREAD}`]: ITEM,
    });
    wrap(<QueuePage search={{}} />);
    const user = userEvent.setup();
    const [first] = await screen.findAllByRole('button', { name: 'Decide here' });
    if (!first) throw new Error('no row');
    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    const inQueue = screen.getByRole('form', { name: 'Decide RL-4HT8-0QNC' });
    await decideIn(inQueue, 'Checked against the photos.');
    await waitFor(() => {
      expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
    });
    const fromQueue = sent.find((s) => s.method === 'POST');
    // The toast, and the row closed.
    expect(await screen.findByText('RL-4HT8-0QNC approved.')).toBeInTheDocument();

    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    const again = serve({
      [`GET /api/moderation/reports/${THREAD}`]: ITEM,
      [`POST /api/moderation/reports/${THREAD}/decision`]: decided,
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const panel = await screen.findByRole('form', { name: 'Decide RL-4HT8-0QNC' });
    await decideIn(panel, 'Checked against the photos.');
    await waitFor(() => {
      expect(again.filter((s) => s.method === 'POST')).toHaveLength(1);
    });
    const fromPage = again.find((s) => s.method === 'POST');
    expect(fromPage).toEqual(fromQueue);
    expect(fromPage).toEqual({
      method: 'POST',
      url: `/api/moderation/reports/${THREAD}/decision`,
      body: { status: 'valid', comment: 'Checked against the photos.' },
    });
  });

  it('asks the reason only after Decline is chosen; the note is optional', async () => {
    const sent = serve({
      [`GET /api/moderation/reports/${THREAD}`]: ITEM,
      [`POST /api/moderation/reports/${THREAD}/decision`]: { ok: true, notice: 'sent' },
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Decide RL-4HT8-0QNC' });
    expect(within(form).queryByLabelText('The reason the reporter is told')).toBeNull();
    await user.click(within(form).getByRole('radio', { name: 'Decline' }));
    const reason = within(form).getByLabelText('The reason the reporter is told');
    // Below the choice just made, never above it.
    expect(
      within(form).getByRole('radio', { name: 'Decline' }).compareDocumentPosition(reason) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(within(form).getByRole('button', { name: 'Record the decision' }));
    expect(within(form).getByText('Choose the reason the reporter is told.')).toBeInTheDocument();
    expect(sent.filter((s) => s.method === 'POST')).toHaveLength(0);
    await user.selectOptions(reason, 'duplicate');
    await user.click(within(form).getByRole('button', { name: 'Record the decision' }));
    // No note written: the decision goes, and carries no comment at all (decision 64).
    await waitFor(() => {
      expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
    });
    expect(sent.find((s) => s.method === 'POST')?.body).toEqual({
      status: 'invalid',
      reason_code: 'duplicate',
    });
  });
});

describe('a bulk decline', () => {
  it('says nobody is emailed, and sends nothing without one reason from the list', async () => {
    const sent = serve({
      'GET /api/moderation/reports': QUEUE,
      'POST /api/moderation/reports/bulk-decline': { bulk_id: 1, declined: [THREAD], skipped: [] },
    });
    wrap(<QueuePage search={{}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select RL-4HT8-0QNC' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Decline selected…' }));
    const dialog = screen.getByRole('dialog', { name: 'Decline 1 selected' });
    expect(within(dialog).getByText('Nobody is emailed when you decline in bulk.')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Decline 1' }));
    expect(within(dialog).getByText(/Choose the reason/)).toBeInTheDocument();
    expect(sent.filter((s) => s.method === 'POST')).toHaveLength(0);
    await user.selectOptions(within(dialog).getByLabelText('The reason'), 'abusive_or_spam');
    await user.click(within(dialog).getByRole('button', { name: 'Decline 1' }));
    await waitFor(() => {
      expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1);
    });
    expect(sent.find((s) => s.method === 'POST')?.body).toMatchObject({
      thread_ids: [THREAD],
      reason_code: 'abusive_or_spam',
    });
  });
});

describe('who filed it', () => {
  it('sends nothing without a written reason, and closing shows nothing', async () => {
    const sent = serve({
      [`GET /api/moderation/reports/${THREAD}`]: ITEM,
      [`POST /api/moderation/reports/${THREAD}/contact`]: {
        contact: { erased: false, email: 'reporter@example.org', filed_by: 'reporter' },
      },
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const user = userEvent.setup();
    const row = await screen.findByRole('region', { name: 'Who filed it' });
    expect(row).toHaveTextContent('Restricted. Every look is logged with your reason.');
    await user.click(within(row).getByRole('button', { name: 'Look… Who filed it' }));
    const bar = screen.getByRole('region', { name: 'Save changes' });
    await user.click(within(bar).getByRole('button', { name: 'Open the details' }));
    expect(within(row).getByText(/Say why you need them/)).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Cancel' }));
    expect(row).toHaveTextContent('Restricted. Every look is logged with your reason.');
    expect(row).not.toHaveTextContent('reporter@example.org');
    expect(sent.filter((s) => s.method === 'POST')).toHaveLength(0);
  });
});
