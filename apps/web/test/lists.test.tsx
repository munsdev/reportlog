/**
 * A list's form, one card at a time. What only a rendered form can show: no
 * card moves on by itself, the address card asks only somebody who wrote
 * something (and says why as they arrive, not while they type), and what is
 * sent is what was answered.
 */
import type { ListForm } from '@reportlog/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListFormView } from '../src/features/lists/ListForm.tsx';

const TIPS: ListForm = {
  slug: 'tips',
  title: 'Send a link',
  blurb: null,
  accepting: true,
  opens_at: null,
  closes_at: null,
  asks_email: true,
  email_when: 'if-written',
  email_reason: 'erase',
  write_back: false,
  personal_keys: ['description'],
  personal_days: 90,
  fields: [
    {
      key: 'links',
      kind: 'url',
      label: 'Link',
      help: null,
      required: true,
      max_values: 3,
      options: [],
      allow_other: false,
      erased: false,
    },
    {
      key: 'state',
      kind: 'choice_one',
      label: 'Where',
      help: null,
      required: true,
      max_values: 1,
      options: ['Ohio', 'Iowa'],
      allow_other: false,
      erased: false,
    },
    {
      key: 'description',
      kind: 'long_text',
      label: 'Anything we should know',
      help: null,
      required: false,
      max_values: 1,
      options: [],
      allow_other: false,
      erased: true,
    },
  ],
};

interface Sent {
  url: string;
  body: unknown;
}

function stubFetch() {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      sent.push({
        url,
        body: JSON.parse(typeof init.body === 'string' ? init.body : 'null') as unknown,
      });
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, erasure_mailed: true, erasable: true }), {
          status: 200,
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: { code: 'not_found', message: 'No.' } }), {
        status: 404,
      }),
    );
  });
  return sent;
}

function show(form: ListForm) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ListFormView form={form} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a list’s form', () => {
  it('says on the cover that nothing sent is published', () => {
    stubFetch();
    show(TIPS);
    expect(screen.getByText(/Nothing you send here is published/)).toBeInTheDocument();
  });

  it('asks one question per card, refuses to move on without a required answer, and never moves on by itself', async () => {
    stubFetch();
    const user = userEvent.setup();
    show(TIPS);
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByRole('heading', { name: 'Link' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Where' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('An answer is needed here.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Link' }), 'https://example.org/a');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(screen.getByRole('radio', { name: 'Ohio' }));
    // Choosing an answer is not a step forward.
    expect(screen.getByRole('heading', { name: 'Where' })).toBeInTheDocument();
  });

  it('asks for no address from somebody who only picked answers, and sends exactly what was answered', async () => {
    const sent = stubFetch();
    const user = userEvent.setup();
    show(TIPS);
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await user.type(screen.getByRole('textbox', { name: 'Link' }), 'https://example.org/a');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('radio', { name: 'Iowa' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Deleted after 90 days/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Not needed: you have not written anything/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('heading', { name: 'Sent. Thank you.' })).toBeInTheDocument();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('/api/lists/tips/entries');
    expect(sent[0]?.body).toMatchObject({
      answers: { links: ['https://example.org/a'], state: 'Iowa' },
      email: null,
    });
  });

  it('asks somebody who wrote something for an address before sending, and says why', async () => {
    const sent = stubFetch();
    const user = userEvent.setup();
    show(TIPS);
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await user.type(screen.getByRole('textbox', { name: 'Link' }), 'https://example.org/a');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('radio', { name: 'Ohio' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Anything we should know' }),
      'Seen on the news',
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Needed, because you wrote something/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      screen.getByText(/You wrote something, so an email address is needed/),
    ).toBeInTheDocument();
    expect(sent).toEqual([]);
    await user.type(screen.getByLabelText(/Your email address/), 'me@example.org');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/We emailed you a link that deletes/)).toBeInTheDocument();
    expect(sent[0]?.body).toMatchObject({ email: 'me@example.org' });
  });

  it('says plainly that the team will write back, on the email card of a list that does', async () => {
    stubFetch();
    const user = userEvent.setup();
    show({ ...TIPS, write_back: true, email_reason: 'reply' });
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await user.type(screen.getByRole('textbox', { name: 'Link' }), 'https://example.org/a');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('radio', { name: 'Ohio' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      screen.getByText(/The team will use this address to write back to you\./),
    ).toBeInTheDocument();
  });

  it('a closed form says so instead of asking anything', () => {
    stubFetch();
    show({ ...TIPS, accepting: false });
    expect(screen.getByText('This form is not taking anything at the moment.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
  });
});
