import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Notifications } from '@reportlog/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationsForm } from '../src/features/site-pages/NotificationsPage.tsx';
import { recordingFetch } from './site-fixture.ts';

const CURRENT: Notifications = {
  frequency: 'weekly',
  logbooks: null,
  choices: [
    { slug: 'munich', title: 'Munich, November' },
    { slug: 'berlin', title: 'Berlin, December' },
  ],
};

function form(current: Notifications = CURRENT) {
  const rec = recordingFetch(current);
  vi.stubGlobal('fetch', rec.fetchImpl);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotificationsForm current={current} />
    </QueryClientProvider>,
  );
  return rec.sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the email updates form', () => {
  // Ported from legacy tools/browser-tests/toggles.test.js.
  it('"every logbook" is ticked, so the list is hidden; unticking shows it; ticking hides it again', async () => {
    const user = userEvent.setup();
    form();
    const all = screen.getByRole('checkbox', { name: /Every logbook/ });
    expect(all).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Munich, November' })).toBeNull();
    await user.click(all);
    expect(screen.getByRole('checkbox', { name: 'Munich, November' })).toBeVisible();
    await user.click(all);
    expect(screen.queryByRole('checkbox', { name: 'Munich, November' })).toBeNull();
  });

  it('sends nothing until Save, and will not save "some logbooks" with none chosen', async () => {
    const user = userEvent.setup();
    const sent = form();
    await user.click(screen.getByRole('checkbox', { name: /Every logbook/ }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one logbook');
    await user.click(screen.getByRole('checkbox', { name: 'Berlin, December' }));
    await user.click(screen.getByRole('radio', { name: /Every hour/ }));
    expect(sent).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(sent).toEqual([
      {
        url: '/api/notifications',
        method: 'PUT',
        body: { frequency: 'hourly', logbooks: ['berlin'] },
      },
    ]);
  });

  it('"no emails" hides the choice of logbooks altogether', async () => {
    const user = userEvent.setup();
    form();
    await user.click(screen.getByRole('radio', { name: /No emails/ }));
    expect(screen.queryByRole('checkbox', { name: /Every logbook/ })).toBeNull();
  });
});
