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
  seen: '3',
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
    for (const name of [
      /^Has a written account/,
      /^Has links to check/,
      /^Has files to check/,
      /^Can go to journalists/,
      /^Needs a second read/,
    ])
      expect(within(work).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
  });

  it('narrows to the reports holding a kind of work, in the address', async () => {
    serve({ 'GET /api/moderation/reports': QUEUE });
    const router = wrap(<QueuePage search={{}} />);
    const user = userEvent.setup();
    const work = await screen.findByRole('group', { name: 'Only reports that' });
    await user.click(within(work).getByRole('button', { name: /^Has links to check/ }));
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ links: true });
    });
  });

  it('asks the server for the work filters in force, and shows them pressed', async () => {
    const sent = serve({ 'GET /api/moderation/reports': QUEUE });
    wrap(<QueuePage search={{ links: true, sharing: true }} />);
    const work = await screen.findByRole('group', { name: 'Only reports that' });
    expect(within(work).getByRole('button', { name: /^Has links to check/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => {
      expect(sent.some((x) => /[?&]links=true/.test(x.url) && /[?&]sharing=true/.test(x.url))).toBe(
        true,
      );
    });
    expect(sent.some((x) => /[?&]written=/.test(x.url))).toBe(false);
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
        written: true,
        sharing: true,
        severity: 'serious',
        lane: 'organization',
      }),
    ).toEqual([
      'matching “hall”',
      'with a written account',
      'the reporter allows journalists',
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

describe('a written account and its links (moderation-unified.md)', () => {
  const text = (ref: string, shared: boolean) => ({
    ref,
    source: 'report' as const,
    text: null,
    length: 120,
    outcome: null,
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
    texts: [text('report-1', true), text('report-2', false)],
    links: [
      {
        group_id: 9,
        ref: 'link-3',
        outcome: null,
        comment: null,
        also_tips: 1,
        also_reports: 0,
      },
    ],
    erased: [],
    shared: true,
  };
  const HOLDING = { ...ITEM, report: { ...REPORT, has_undecided_written: true } };

  it('offers a note only where the reporter allowed it, and erasing everywhere', async () => {
    serve({
      [`GET /api/moderation/reports/${THREAD}`]: HOLDING,
      [`GET /api/moderation/reports/${THREAD}/written`]: WRITTEN,
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const panels = await screen.findAllByRole('region', { name: /^Written account/ });
    expect(panels).toHaveLength(2);
    const [shared, unshared] = panels as [HTMLElement, HTMLElement];
    expect(
      within(shared).getByRole('button', { name: 'Write a note for journalists' }),
    ).toBeVisible();
    expect(
      within(shared).getByRole('button', { name: 'Leave it with the report (staff only)' }),
    ).toBeVisible();
    // Not shared: nothing waits on a moderator, and the one act is erasing.
    expect(
      within(unshared)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Show the written account', 'Erase as illegal…']);
    // The link: its verdict, judged once for every copy.
    expect(await screen.findByText(/Not judged yet\. Also sent in 1 tip\./)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Judge this link' })).toBeVisible();
  });

  it('approving leaves the accounts with the report unless asked, and judges the link', async () => {
    const sent = serve({
      [`GET /api/moderation/reports/${THREAD}`]: HOLDING,
      [`GET /api/moderation/reports/${THREAD}/written`]: WRITTEN,
      [`POST /api/moderation/reports/${THREAD}/decision`]: { ok: true, notice: 'none' },
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Decide RL-4HT8-0QNC' });
    await user.click(within(form).getByRole('radio', { name: 'Approve' }));
    // Only the shared account is asked about, with "leave it" chosen already.
    const account = await within(form).findByRole('radiogroup', { name: 'Written account' });
    expect(
      within(account).getByRole('radio', { name: 'Leave it with the report (staff only)' }),
    ).toBeChecked();
    expect(within(form).queryAllByRole('radiogroup', { name: /^Written account/ })).toHaveLength(1);
    // The link has no verdict yet, so one is asked for.
    await user.click(within(form).getByRole('button', { name: 'Record the decision' }));
    expect(within(form).getByText(/Judge each link below/)).toBeInTheDocument();
    expect(sent.filter(isAct)).toHaveLength(0);
    const link = within(form).getByRole('radiogroup', { name: 'Link' });
    await user.click(within(link).getByRole('radio', { name: /^Withheld/ }));
    await user.click(within(form).getByRole('button', { name: 'Record the decision' }));
    await waitFor(() => {
      expect(sent.filter(isAct)).toHaveLength(1);
    });
    // No reason was asked; the server keeps one, so each says what was done.
    expect(sent.find(isAct)?.body).toEqual({
      status: 'valid',
      seen: REPORT.seen,
      written: [
        { ref: 'report-1', outcome: 'withheld', why: 'Left with the report, for staff only.' },
        { ref: 'report-2', outcome: 'withheld', why: 'Left with the report, for staff only.' },
        { ref: 'link-3', outcome: 'withheld', why: 'Judged when the report was approved.' },
      ],
    });
  });

  it('a note for journalists goes with the approval, in the moderator’s words', async () => {
    const sent = serve({
      [`GET /api/moderation/reports/${THREAD}`]: HOLDING,
      [`GET /api/moderation/reports/${THREAD}/written`]: { ...WRITTEN, links: [] },
      [`POST /api/moderation/reports/${THREAD}/decision`]: { ok: true, notice: 'none' },
    });
    wrap(<ItemPage threadId={THREAD} />, `/moderate/${THREAD}`);
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Decide RL-4HT8-0QNC' });
    await user.click(within(form).getByRole('radio', { name: 'Approve' }));
    const account = await within(form).findByRole('radiogroup', { name: 'Written account' });
    await user.click(within(account).getByRole('radio', { name: 'Write a note for journalists' }));
    await user.type(
      within(form).getByLabelText('Written account: note for journalists'),
      'A polling place moved without notice.',
    );
    await user.click(within(form).getByRole('button', { name: 'Record the decision' }));
    await waitFor(() => {
      expect(sent.filter(isAct)).toHaveLength(1);
    });
    expect(sent.find(isAct)?.body).toMatchObject({
      written: [
        {
          ref: 'report-1',
          outcome: 'redacted',
          why: 'Wrote a note for journalists.',
          note: 'A polling place moved without notice.',
        },
        { ref: 'report-2', outcome: 'withheld' },
      ],
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
