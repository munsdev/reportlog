/**
 * The filing form: which cards are asked, that choosing never moves anybody
 * on, and that on a door the page asks the server for nothing but the
 * filing calls.
 */
import type { FormQuestion } from '@reportlog/contracts';
import { cardFor } from '@reportlog/seal';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import type { RouterHistory } from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilingForm } from '../src/features/form/FilingForm.tsx';
import {
  askedQuestions,
  cardProblem,
  rawFromAnswers,
  shownAnswer,
  stillPossible,
  toSubmission,
} from '../src/features/form/walk.ts';
import { SiteGate } from '../src/features/identity/gate.tsx';
import { DESK } from './look-fixture.ts';

const QS: FormQuestion[] = [
  { key: 'what', kind: 'long_text', label: 'What happened?', required: true, settings: {} },
  { key: 'seen', kind: 'yes_no', label: 'Did anybody see it?', required: false, settings: {} },
  {
    key: 'who',
    kind: 'short_text',
    label: 'Who saw it?',
    required: true,
    settings: {},
    shown_when: { field: 'seen', in: ['yes'] },
  },
  {
    key: 'how',
    kind: 'choice_one',
    label: 'How did they see it?',
    required: false,
    settings: { options: ['In person', 'On video'] },
    shown_when: { field: 'who', in: ['x'] },
  },
  { key: 'photo', kind: 'file', label: 'Photos', required: false, settings: {} },
  { key: 'at', kind: 'datetime', label: 'When?', required: false, settings: {} },
];

function question(key: string): FormQuestion {
  const found = QS.find((q) => q.key === key);
  if (!found) throw new Error(`no question ${key}`);
  return found;
}

describe('the walk', () => {
  it('asks a conditional question only when the earlier answer turns it on', () => {
    const keys = (raw: Record<string, string>) => askedQuestions(QS, raw).map((q) => q.key);
    expect(keys({})).toEqual(['what', 'seen', 'at']);
    expect(keys({ seen: 'no' })).toEqual(['what', 'seen', 'at']);
    expect(keys({ seen: 'yes' })).toEqual(['what', 'seen', 'who', 'at']);
  });

  it('sends nothing for a question no longer asked, even if its box still holds text', () => {
    expect(toSubmission(QS, { what: 'x', seen: 'no', who: 'Left over' })).toEqual({
      what: 'x',
      seen: 'no',
    });
  });

  it('sends a date and time as UTC', () => {
    const local = '2026-10-19T09:30';
    expect(toSubmission(QS, { what: 'x', at: local }).at).toBe(new Date(local).toISOString());
    expect(rawFromAnswers(QS, { at: new Date(local).toISOString() }).at).toBe(local);
  });

  it('requires an answer only of the people asked, and refuses one the question cannot take', () => {
    const what = question('what');
    expect(cardProblem(what, {})).toBe('An answer is needed here.');
    expect(cardProblem(what, { what: 'Something' })).toBeNull();
    const how = question('how');
    expect(cardProblem(how, { how: 'Telepathy' })).toMatch(/not an answer/);
  });

  it('counts a follow-up of a follow-up as possible only while what it hangs off is', () => {
    // For the progress bar: "how" hangs off "who", which hangs off "seen".
    const possible = (raw: Record<string, string>) =>
      QS.filter((q) => stillPossible(q, QS, raw)).map((q) => q.key);
    expect(possible({})).toEqual(['what', 'seen', 'who', 'how', 'at']);
    expect(possible({ seen: 'yes' })).toEqual(['what', 'seen', 'who', 'how', 'at']);
    expect(possible({ seen: 'yes', who: 'y' })).toEqual(['what', 'seen', 'who', 'at']);
    // Ruled out at the root: neither follow-up can come, so neither counts.
    expect(possible({ seen: 'no' })).toEqual(['what', 'seen', 'at']);
  });

  it('shows answers in the words read, and reads sealed answers back into the boxes', () => {
    expect(shownAnswer(question('seen'), { seen: 'yes' })).toBe('Yes');
    expect(rawFromAnswers(QS, { seen: false, what: 'x' })).toEqual({ seen: 'no', what: 'x' });
  });
});

describe('the cards', () => {
  const card = cardFor('general');
  const calls: string[] = [];
  afterEach(() => {
    calls.length = 0;
    vi.unstubAllGlobals();
  });

  const UPLOADS = {
    enabled: true,
    kinds: ['photo'],
    accept: ['image/jpeg'],
    max_files: 2,
    max_total_bytes: 10 * 1024 * 1024,
    max_bytes: { photo: 5 * 1024 * 1024, video: 0, audio: 0, document: 0 },
    max_video_seconds: 180,
    max_document_pages: 40,
  };

  function onDoor(
    fields: FormQuestion[] = QS,
    cards?: RouterHistory,
    sent: Record<string, unknown> = { pending: true },
  ) {
    // jsdom lays nothing out, so there is nowhere to scroll to.
    vi.stubGlobal('scrollTo', vi.fn());
    const answers: Record<string, unknown> = {
      'GET /api/site-access/status': { locked: true, dev_mode_until: null, look: DESK },
      'GET /api/logbooks/demo': {
        slug: 'demo',
        title: 'Demo logbook',
        blurb: null,
        state: 'open',
        opens_at: null,
        closes_at: null,
        accepting: true,
        asks_for_files: fields.some((q) => q.kind === 'file'),
        asks_email: true,
        fields,
        filters: [],
        help_now: 'This is a record, not an emergency line.',
      },
      'GET /api/publication-card': card,
      'GET /api/intake-switch': { open: true },
      'GET /api/intake-pause': { paused: false, since: null, notice: '' },
      'POST /api/reports': sent,
      'GET /api/uploads/config': UPLOADS,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const key = `${init?.method ?? 'GET'} ${url.split('?')[0] ?? url}`;
        calls.push(key);
        const body = answers[key];
        return Promise.resolve(
          body === undefined
            ? new Response(JSON.stringify({ error: { code: 'locked', message: 'Locked.' } }), {
                status: 401,
              })
            : new Response(JSON.stringify(body), { status: 200 }),
        );
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const history = { block: vi.fn(() => vi.fn()) } as unknown as RouterHistory;
    return render(
      <QueryClientProvider client={client}>
        <SiteGate history={history} pathname="/file/demo">
          <FilingForm slug="demo" {...(cards ? { history: cards } : {})} />
        </SiteGate>
      </QueryClientProvider>,
    );
  }

  it('walks one question per card, never moving on by itself, and sends only filing calls', async () => {
    const user = userEvent.setup();
    onDoor();
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    expect(screen.getByRole('heading', { name: 'What happened?' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('An answer is needed here.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'What happened?' }), 'It happened.');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    // Still the same card, and nothing new on it.
    expect(screen.getByRole('heading', { name: 'Did anybody see it?' })).toBeInTheDocument();
    expect(screen.queryByText('Who saw it?')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Who saw it?' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Who saw it?' }), 'A neighbour');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    // The upload question has no card here; the next is the date.
    expect(screen.getByRole('heading', { name: 'When?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('heading', { name: card.question })).toBeInTheDocument();
    expect(screen.getByText(card.optionality)).toBeInTheDocument();
    // Not answered: allowed, and it means no.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('Your email address'), 'me@example.org');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    // The upload question's card comes after the address, wherever it was
    // placed: the server's staging quota is keyed on the address. Optional,
    // and nothing is uploaded unless a file is picked.
    expect(screen.getByRole('heading', { name: 'Photos' })).toBeInTheDocument();
    expect(screen.getByText(/removed from any copy that could ever be shown/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('checkbox', { name: /I confirm this report is accurate/ }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();

    expect([...new Set(calls)].sort()).toEqual([
      'GET /api/intake-pause',
      'GET /api/intake-switch',
      'GET /api/logbooks/demo',
      'GET /api/publication-card',
      'GET /api/site-access/status',
      'GET /api/uploads/config',
      'POST /api/reports',
    ]);
    const sendCall = vi.mocked(fetch).mock.calls.find((c) => c[1]?.method === 'POST');
    expect(JSON.parse(sendCall?.[1]?.body as string)).toEqual({
      logbook: 'demo',
      email: 'me@example.org',
      consent: true,
      answers: { what: 'It happened.', seen: 'yes', who: 'A neighbour' },
      may_publish: false,
      may_publish_digest: card.digest,
    });
  });

  it('a logbook that does not ask for files never calls the upload routes (on a door they would not pass)', async () => {
    const user = userEvent.setup();
    onDoor([{ key: 'what', kind: 'short_text', label: 'What?', required: true, settings: {} }]);
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await user.type(screen.getByRole('textbox', { name: 'What?' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('Your email address'), 'me@example.org');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Check your answers' })).toBeInTheDocument();
    expect(calls.filter((c) => c.includes('/api/uploads'))).toEqual([]);
  });

  it('offers a tip after Send, and keeps the state and time in this browser only', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    onDoor([{ key: 'state', kind: 'short_text', label: 'State?', required: true, settings: {} }]);
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await user.type(screen.getByRole('textbox', { name: 'State?' }), 'Ohio');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('Your email address'), 'me@example.org');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('checkbox', { name: /I confirm this report is accurate/ }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/Thank you\. Have a link, photo or video\?/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send a link' })).toHaveAttribute('href', '/list/tips');
    const kept = JSON.parse(localStorage.getItem('reportlog:tip-prefill') ?? 'null') as {
      values: Record<string, string>;
    };
    expect(kept.values).toEqual({ state: 'Ohio' });
  });

  describe('one history entry per card', () => {
    const heading = (name: string) => screen.findByRole('heading', { name });
    const press = (user: ReturnType<typeof userEvent.setup>, name: string) =>
      user.click(screen.getByRole('button', { name }));
    const browser = (move: () => void) => {
      act(move);
    };

    it("the browser's Back goes back one question, and Forward returns, answers kept", async () => {
      const user = userEvent.setup();
      const cards = createMemoryHistory({ initialEntries: ['/file/demo?from=poster'] });
      onDoor(QS, cards);
      await user.click(await screen.findByRole('button', { name: 'Start' }));
      await user.type(screen.getByRole('textbox', { name: 'What happened?' }), 'It happened.');
      await press(user, 'Next');
      await heading('Did anybody see it?');
      // Every entry is the same address, query and all.
      expect(cards.location.href).toBe('/file/demo?from=poster');

      browser(() => {
        cards.back();
      });
      expect(await heading('What happened?')).toHaveFocus();
      expect(screen.getByRole('textbox', { name: 'What happened?' })).toHaveValue('It happened.');
      browser(() => {
        cards.back();
      });
      await screen.findByRole('button', { name: 'Start' });
      browser(() => {
        cards.forward();
      });
      await heading('What happened?');
      browser(() => {
        cards.forward();
      });
      await heading('Did anybody see it?');
    });

    it("the page's Back is the browser's, so after Change it returns to the review", async () => {
      const user = userEvent.setup();
      const cards = createMemoryHistory({ initialEntries: ['/file/demo'] });
      onDoor(
        [{ key: 'what', kind: 'short_text', label: 'What?', required: true, settings: {} }],
        cards,
      );
      await user.click(await screen.findByRole('button', { name: 'Start' }));
      await user.type(screen.getByRole('textbox', { name: 'What?' }), 'x');
      await press(user, 'Next');
      await press(user, 'Next');
      await user.type(screen.getByLabelText('Your email address'), 'me@example.org');
      await press(user, 'Next');
      await heading('Check your answers');
      await user.click(screen.getByRole('button', { name: 'Change: What?' }));
      await heading('What?');
      await press(user, 'Back');
      await heading('Check your answers');
      // And Next from a card reached by Change returns to the review too.
      browser(() => {
        cards.forward();
      });
      await heading('What?');
      await press(user, 'Next');
      await heading('Check your answers');
    });

    it('a card the answers since have stopped asking gives way to the one before it', async () => {
      const user = userEvent.setup();
      const cards = createMemoryHistory({ initialEntries: ['/file/demo'] });
      onDoor(QS, cards);
      await user.click(await screen.findByRole('button', { name: 'Start' }));
      await user.type(screen.getByRole('textbox', { name: 'What happened?' }), 'It happened.');
      await press(user, 'Next');
      await user.click(screen.getByRole('radio', { name: 'Yes' }));
      await press(user, 'Next');
      await heading('Who saw it?');
      await press(user, 'Back');
      await heading('Did anybody see it?');
      // Changing the answer here never moves the card on...
      await user.click(screen.getByRole('radio', { name: 'No' }));
      expect(screen.getByRole('heading', { name: 'Did anybody see it?' })).toBeInTheDocument();
      // ...and Forward to "Who saw it?", no longer asked, stays here.
      browser(() => {
        cards.forward();
      });
      await heading('Did anybody see it?');
      expect(screen.queryByRole('heading', { name: 'Who saw it?' })).not.toBeInTheDocument();
      // The entry the browser is on now says so.
      expect(cards.location.state).toMatchObject({ filingCard: 'q:seen' });
    });

    it('an entry left from before a reload starts the form again', async () => {
      const user = userEvent.setup();
      const cards = createMemoryHistory({ initialEntries: ['/file/demo'] });
      // What the browser keeps from an earlier visit to the page.
      cards.push('/file/demo', { filingVisit: 'earlier', filingCard: 'q:seen' });
      cards.push('/file/demo', { filingVisit: 'earlier', filingCard: 'q:at' });
      onDoor(QS, cards);
      await user.click(await screen.findByRole('button', { name: 'Start' }));
      await heading('What happened?');
      await press(user, 'Back');
      await screen.findByRole('button', { name: 'Start' });
      browser(() => {
        cards.back();
      });
      // "Did anybody see it?" from the earlier visit: nothing behind it here.
      await screen.findByRole('button', { name: 'Start' });
      expect(
        screen.queryByRole('heading', { name: 'Did anybody see it?' }),
      ).not.toBeInTheDocument();
      expect(cards.location.state).toMatchObject({ filingCard: 'intro' });
      expect(cards.location.state).not.toMatchObject({ filingVisit: 'earlier' });
    });
  });
});
