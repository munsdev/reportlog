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
  attachments_waiting: 0,
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
  seen: '3',
};
const SECOND: QueueItem = { ...REPORT, thread_id: OTHER, public_ref: 'RL-7K2M-4QXD' };

const QUEUE = {
  reports: [REPORT, SECOND],
  open_flags: 2,
  unrated: 0,
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

/** A POST that acts on a report: not the heartbeat saying the page is open. */
const isAct = (s: Sent) => s.method === 'POST' && !s.url.endsWith('/viewing');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the queue', () => {
  it('shows a count on each status button, with Waiting pressed', async () => {
    serve({ 'GET /api/moderation/reports': QUEUE });
    wrap(<QueuePage search={{}} />);
    const group = await screen.findByRole('group', { name: 'Show' });
    const waiting = within(group).getByRole('button', { name: /^Waiting/ });
    expect(waiting).toHaveAttribute('aria-pressed', 'true');
    expect(await within(group).findByText(/7 waiting/)).toBeInTheDocument();
    expect(within(group).getByText(/19 approved/)).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: /^Approved/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // The work a report holds is not a status: each narrows whichever one is
    // showing, in a row of its own, none pressed until asked.
    const work = screen.getByRole('group', { name: 'Only reports that' });
    for (const name of [/^Has attachments to review/, /^Needs a second read/])
      expect(within(work).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
  });

  it('narrows to the reports holding a kind of work, in the address', async () => {
    serve({ 'GET /api/moderation/reports': QUEUE });
    const router = wrap(<QueuePage search={{}} />);
    const user = userEvent.setup();
    const work = await screen.findByRole('group', { name: 'Only reports that' });
    await user.click(within(work).getByRole('button', { name: /^Has attachments to review/ }));
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ attachments: true });
    });
  });

  it('asks the server for the work filters in force, and shows them pressed', async () => {
    const sent = serve({ 'GET /api/moderation/reports': QUEUE });
    wrap(<QueuePage search={{ attachments: true }} />);
    const work = await screen.findByRole('group', { name: 'Only reports that' });
    expect(
      within(work).getByRole('button', { name: /^Has attachments to review/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(sent.some((x) => /[?&]attachments=true/.test(x.url))).toBe(true);
    });
    expect(sent.some((x) => /[?&]flagged=/.test(x.url))).toBe(false);
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
      filterWords({
        q: 'hall',
        flagged: true,
        attachments: true,
        severity: 'serious',
        lane: 'organization',
      }),
    ).toEqual([
      'matching “hall”',
      'with attachments to review',
      'waiting for a second read',
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
      expect(sent.filter(isAct)).toHaveLength(1);
    });
    const fromQueue = sent.find(isAct);
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
      expect(again.filter(isAct)).toHaveLength(1);
    });
    const fromPage = again.find(isAct);
    expect(fromPage).toEqual(fromQueue);
    expect(fromPage).toEqual({
      method: 'POST',
      url: `/api/moderation/reports/${THREAD}/decision`,
      // `seen` is the version the page showed, so a decision on a report that
      // moved since is refused rather than written over.
      body: { status: 'valid', comment: 'Checked against the photos.', seen: REPORT.seen },
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
    expect(sent.filter(isAct)).toHaveLength(0);
    await user.selectOptions(reason, 'duplicate');
    await user.click(within(form).getByRole('button', { name: 'Record the decision' }));
    // No note written: the decision goes, and carries no comment at all (decision 64).
    await waitFor(() => {
      expect(sent.filter(isAct)).toHaveLength(1);
    });
    expect(sent.find(isAct)?.body).toEqual({
      status: 'invalid',
      reason_code: 'duplicate',
      seen: REPORT.seen,
    });
  });
});

describe('rating while approving', () => {
  it('is offered under Approve on an unrated report, optional, and needs a reason once chosen', async () => {
    const sent = serve({
      [`GET /api/moderation/reports/${THREAD}`]: ITEM,
      [`POST /api/moderation/reports/${THREAD}/decision`]: { ok: true, notice: 'none' },
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Decide RL-4HT8-0QNC' });
    expect(within(form).queryByLabelText('Rate its severity (optional)')).toBeNull();
    await user.click(within(form).getByRole('radio', { name: 'Decline' }));
    expect(within(form).queryByLabelText('Rate its severity (optional)')).toBeNull();
    await user.click(within(form).getByRole('radio', { name: 'Approve' }));
    const rating = within(form).getByLabelText('Rate its severity (optional)');
    // Starts on "Not now": nothing is rated by default.
    expect(rating).toHaveValue('');
    await user.selectOptions(rating, 'serious');
    await user.click(within(form).getByRole('button', { name: 'Record the decision' }));
    expect(
      within(form).getByText('Say why this rating, or set the rating back to "Not now".'),
    ).toBeInTheDocument();
    expect(sent.filter(isAct)).toHaveLength(0);
    await user.type(within(form).getByLabelText('Why this rating'), 'People were turned away.');
    await user.click(within(form).getByRole('button', { name: 'Record the decision' }));
    await waitFor(() => {
      expect(sent.filter(isAct)).toHaveLength(1);
    });
    expect(sent.find(isAct)?.body).toEqual({
      status: 'valid',
      seen: REPORT.seen,
      severity: 'serious',
      severity_comment: 'People were turned away.',
    });
  });

  it('is not offered on a report already rated: changing it is the Severity row’s', async () => {
    serve({
      [`GET /api/moderation/reports/${THREAD}`]: {
        ...ITEM,
        report: { ...REPORT, severity: 'note' },
        assessment: { ...ITEM.assessment, severity: 'note' },
      },
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Decide RL-4HT8-0QNC' });
    await user.click(within(form).getByRole('radio', { name: 'Approve' }));
    expect(within(form).queryByLabelText('Rate its severity (optional)')).toBeNull();
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
    expect(sent.filter(isAct)).toHaveLength(0);
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'abusive_or_spam');
    await user.click(within(dialog).getByRole('button', { name: 'Decline 1' }));
    await waitFor(() => {
      expect(sent.filter(isAct)).toHaveLength(1);
    });
    expect(sent.find(isAct)?.body).toMatchObject({
      thread_ids: [THREAD],
      reason_code: 'abusive_or_spam',
      seen: { [THREAD]: REPORT.seen, [OTHER]: SECOND.seen },
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
    const row = (await screen.findByRole('heading', { name: 'Who filed it' })).closest('section');
    if (!row) throw new Error('no Who filed it panel');
    const restricted =
      'Restricted. Every look is logged with your reason, and the reporter is told.';
    expect(row).toHaveTextContent(restricted);
    await user.click(within(row).getByRole('button', { name: 'Open the details…' }));
    const dialog = screen.getByRole('dialog', { name: 'Why do you need to see who filed it?' });
    await user.click(within(dialog).getByRole('button', { name: 'Open the details' }));
    expect(within(dialog).getByText(/Say why you need them/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(row).toHaveTextContent(restricted);
    expect(row).not.toHaveTextContent('reporter@example.org');
    expect(sent.filter(isAct)).toHaveLength(0);
  });
});

describe('two moderators on one report', () => {
  const viewingUrl = `POST /api/moderation/reports/${THREAD}/viewing`;

  it('the report page says who else has it open', async () => {
    serve({
      [`GET /api/moderation/reports/${THREAD}`]: ITEM,
      [viewingUrl]: { others: [{ email: 'maria@example.org' }], seen: REPORT.seen },
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    expect(
      await screen.findByText(/maria@example\.org has it open too\. If you are both deciding it/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^This report changed after you opened it/)).toBeNull();
  });

  it('says the report changed, and does not change it underneath the reader', async () => {
    const sent = serve({
      [`GET /api/moderation/reports/${THREAD}`]: ITEM,
      [viewingUrl]: { others: [], seen: '4' },
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    expect(await screen.findByText(/^This report changed after you opened it/)).toBeInTheDocument();
    const reads = () => sent.filter((s) => s.url === `/api/moderation/reports/${THREAD}`).length;
    expect(reads()).toBe(1);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show it as it is now' }));
    await waitFor(() => {
      expect(reads()).toBe(2);
    });
  });

  it("a decision on a report somebody else decided shows the server's sentence and records nothing", async () => {
    const sentence =
      'maria@example.org approved it after you opened it. Nothing you sent was recorded. Look at it again before you decide.';
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const key = `${init?.method ?? 'GET'} ${url}`;
        if (key === `POST /api/moderation/reports/${THREAD}/decision`) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: { code: 'changed', message: sentence } }), {
              status: 409,
            }),
          );
        }
        const body =
          key === `GET /api/moderation/reports/${THREAD}`
            ? ITEM
            : key === viewingUrl
              ? { others: [], seen: REPORT.seen }
              : { ok: true };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }),
    );
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Decide RL-4HT8-0QNC' });
    await user.click(within(form).getByRole('radio', { name: 'Approve' }));
    await user.click(within(form).getByRole('button', { name: 'Record the decision' }));
    expect(await within(form).findByText(sentence)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Show it as it is now' })).toBeInTheDocument();
    expect(screen.queryByText(/RL-4HT8-0QNC approved\./)).toBeNull();
  });

  it('the queue marks a report somebody else has open', async () => {
    serve({
      'GET /api/moderation/reports': QUEUE,
      'GET /api/moderation/viewing': {
        viewing: [{ thread_id: OTHER, email: 'maria@example.org' }],
      },
    });
    wrap(<QueuePage search={{}} />);
    const rows = await screen.findAllByRole('listitem');
    const second = rows.find((r) => r.textContent.includes('RL-7K2M-4QXD'));
    if (!second) throw new Error('no second row');
    expect(await within(second).findByText('maria@example.org has it open')).toBeInTheDocument();
    const first = rows.find((r) => r.textContent.includes('RL-4HT8-0QNC'));
    expect(first).not.toHaveTextContent('has it open');
  });
});

describe('attachments are reviewed apart from the report (decision 83)', () => {
  const text = (ref: string, shared: boolean, outcome: 'redacted' | 'withheld' | null) => ({
    ref,
    source: 'report' as const,
    text: null,
    length: 120,
    outcome,
    checked_at: null,
    checked_by: null,
    shared,
    reference: REPORT.public_ref,
    thread_id: THREAD,
    place: null,
    form_title: 'Election incidents',
    answers_public: false,
    received_at: REPORT.received_at,
    redaction: null,
  });
  const WRITTEN = {
    texts: [text('report-1', true, null), text('report-2', true, 'redacted')],
    links: [
      {
        group_id: 9,
        ref: 'link-3',
        outcome: 'withheld',
        comment: null,
        also_tips: 0,
        also_reports: 0,
      },
    ],
    erased: [],
    shared: true,
  };
  const HOLDING = { ...ITEM, report: { ...REPORT, attachments_waiting: 1 } };

  it('shows each attachment with its own status', async () => {
    serve({
      [`GET /api/moderation/reports/${THREAD}`]: HOLDING,
      [`GET /api/moderation/reports/${THREAD}/written`]: WRITTEN,
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const section = await screen.findByRole('region', { name: 'Attachments' });
    expect(within(section).getByText(/shows none of these to anybody/)).toBeVisible();
    const [waiting, noted] = within(section).getAllByRole('region', { name: /^Written account/ });
    if (!waiting || !noted) throw new Error('two accounts');
    expect(within(waiting).getByText('Waiting')).toBeVisible();
    expect(within(noted).getByText('Shown to journalists')).toBeVisible();
    expect(within(section).getByText('Kept back')).toBeVisible();
  });

  it('a declined report keeps every attachment back', async () => {
    serve({
      [`GET /api/moderation/reports/${THREAD}`]: {
        ...HOLDING,
        report: { ...HOLDING.report, moderation_status: 'invalid' },
      },
      [`GET /api/moderation/reports/${THREAD}/written`]: WRITTEN,
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const section = await screen.findByRole('region', { name: 'Attachments' });
    expect(within(section).getAllByText('Kept back')).toHaveLength(3);
    expect(within(section).queryByText('Waiting')).toBeNull();
  });

  it('opens the note editor only when asked, and shows the words once', async () => {
    serve({
      [`GET /api/moderation/reports/${THREAD}`]: HOLDING,
      [`GET /api/moderation/reports/${THREAD}/written`]: WRITTEN,
      'GET /api/moderation/texts/report-1': {
        item: { ...text('report-1', true, null), redaction: null },
        history: [],
        redacted: null,
      },
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const user = userEvent.setup();
    const [waiting] = await screen.findAllByRole('region', { name: /^Written account/ });
    if (!waiting) throw new Error('no account');
    expect(within(waiting).queryByLabelText('The note journalists read')).toBeNull();
    await user.click(within(waiting).getByRole('button', { name: 'Write a note for journalists' }));
    expect(await within(waiting).findByLabelText('The note journalists read')).toBeVisible();
    expect(
      within(waiting).getAllByRole('button', { name: 'Show the written account' }),
    ).toHaveLength(1);
    await user.click(within(waiting).getByRole('button', { name: 'Cancel' }));
    expect(within(waiting).queryByLabelText('The note journalists read')).toBeNull();
  });

  it('folds the less-used actions under More, after the attachments', async () => {
    serve({
      [`GET /api/moderation/reports/${THREAD}`]: HOLDING,
      [`GET /api/moderation/reports/${THREAD}/written`]: WRITTEN,
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const section = await screen.findByRole('region', { name: 'Attachments' });
    const more = screen.getByText('More').closest('details');
    if (!more) throw new Error('no More');
    expect(more.open).toBe(false);
    expect(section.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('"Leave it" sends no reason', async () => {
    const sent = serve({
      [`GET /api/moderation/reports/${THREAD}`]: HOLDING,
      [`GET /api/moderation/reports/${THREAD}/written`]: WRITTEN,
      'POST /api/moderation/texts/report-1/check': { outcome: 'withheld', erased: false },
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const user = userEvent.setup();
    const [waiting] = await screen.findAllByRole('region', { name: /^Written account/ });
    if (!waiting) throw new Error('no account');
    await user.click(
      within(waiting).getByRole('button', { name: 'Leave it with the report (staff only)' }),
    );
    await waitFor(() => {
      expect(sent.filter((s) => s.url.endsWith('/check'))).toHaveLength(1);
    });
    expect(sent.find((s) => s.url.endsWith('/check'))?.body).toEqual({ outcome: 'withheld' });
  });

  it('approving asks nothing about attachments and says they stay hidden', async () => {
    const sent = serve({
      [`GET /api/moderation/reports/${THREAD}`]: HOLDING,
      [`GET /api/moderation/reports/${THREAD}/written`]: WRITTEN,
      [`POST /api/moderation/reports/${THREAD}/decision`]: { ok: true, notice: 'none' },
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Decide RL-4HT8-0QNC' });
    await user.click(within(form).getByRole('radio', { name: 'Approve' }));
    expect(within(form).getByText(/reviewed on its own and stays hidden/)).toBeVisible();
    await user.click(within(form).getByRole('button', { name: 'Record the decision' }));
    await waitFor(() => {
      expect(sent.filter(isAct)).toHaveLength(1);
    });
    expect(sent.find(isAct)?.body).toEqual({ status: 'valid', seen: REPORT.seen });
  });

  it('a report holding attachments can be picked for a batch, and says how many wait', async () => {
    serve({
      'GET /api/moderation/reports': {
        ...QUEUE,
        reports: [{ ...REPORT, attachments_waiting: 2 }, SECOND],
      },
    });
    wrap(<QueuePage search={{}} />);
    expect(await screen.findByText('2 attachments to review')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Select RL-4HT8-0QNC' })).toBeEnabled();
  });
});
