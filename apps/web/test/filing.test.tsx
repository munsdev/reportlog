/**
 * The filing form: which cards are asked, that choosing never moves anybody
 * on, and that on a door the page asks the server for nothing but the
 * filing calls.
 */
import type { FormQuestion } from '@reportlog/contracts';
import { cardFor } from '@reportlog/seal';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RouterHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilingForm } from '../src/features/form/FilingForm.tsx';
import {
  askedQuestions,
  cardProblem,
  rawFromAnswers,
  shownAnswer,
  toSubmission,
} from '../src/features/form/walk.ts';
import { SiteGate } from '../src/features/identity/gate.tsx';

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

  function onDoor() {
    // jsdom lays nothing out, so there is nowhere to scroll to.
    vi.stubGlobal('scrollTo', vi.fn());
    const answers: Record<string, unknown> = {
      'GET /api/site-access/status': { locked: true },
      'GET /api/logbooks/demo': {
        slug: 'demo',
        title: 'Demo logbook',
        blurb: null,
        state: 'open',
        opens_at: null,
        closes_at: null,
        accepting: true,
        asks_for_files: true,
        fields: QS,
        filters: [],
      },
      'GET /api/publication-card': card,
      'POST /api/reports': { pending: true },
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
          <FilingForm slug="demo" />
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
    await user.click(screen.getByRole('checkbox', { name: /I confirm this report is accurate/ }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();

    expect([...new Set(calls)].sort()).toEqual([
      'GET /api/logbooks/demo',
      'GET /api/publication-card',
      'GET /api/site-access/status',
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
});
