/**
 * "Show address" on the list review page: nothing about an address is on the
 * page until a reviewer asks, one entry at a time, and a refusal is said in
 * words rather than swallowed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShowAddress } from '../src/features/lists/ListReview.tsx';

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ShowAddress listId={7} entryId={42} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Show address', () => {
  it('asks the server only when pressed, then shows the address and can hide it again', async () => {
    const calls: { url: string; method: string | undefined }[] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      return Promise.resolve(new Response(JSON.stringify({ address: 'ada@example.org' })));
    });
    const user = userEvent.setup();
    show();
    expect(calls).toEqual([]);
    expect(screen.queryByText('ada@example.org')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show address for entry 42' }));
    expect(await screen.findByText('ada@example.org')).toBeInTheDocument();
    expect(calls).toEqual([{ url: '/api/list-review/7/entries/42/address', method: 'POST' }]);

    await user.click(screen.getByRole('button', { name: 'Hide address for entry 42' }));
    expect(screen.queryByText('ada@example.org')).not.toBeInTheDocument();
  });

  it('says why when the server refuses', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: 'no-address', message: 'There is no address to show.' },
          }),
          { status: 404 },
        ),
      ),
    );
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Show address for entry 42' }));
    expect(await screen.findByText('There is no address to show.')).toBeInTheDocument();
  });
});
