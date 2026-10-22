/**
 * P2's screens without a server: the footer's attribution and version
 * line, the development badge, a slot of page wording, inserting a number,
 * and the one unsaved-changes question for the settings area.
 *
 * Ports selftest.js "Attribution survives renaming": the footer credits the
 * software whatever the site is called, and that line is written from the
 * software's name, never from the site's.
 */
import type { Site } from '@reportlog/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyText } from '../src/components/ui/copy-text.tsx';
import { DevBadge } from '../src/components/ui/dev-badge.tsx';
import { SiteFooter, versionLine } from '../src/components/ui/site-footer.tsx';
import { UnsavedChangesGuard, unsavedQuestion } from '../src/routes/(staff)/settings/-editor.tsx';
import { LookForm } from '../src/routes/(staff)/settings/look.tsx';
import { SlotEditor, insertAt } from '../src/routes/(staff)/settings/words.tsx';
import { editorState, recordingFetch } from './site-fixture.ts';

function site(overrides: Partial<Site> = {}): Site {
  return {
    software_name: 'ReportLog',
    name: 'Munich "Archive"',
    name_parts: [
      { text: 'Munich ', mark: '' },
      { text: 'Archive', mark: 'a' },
    ],
    plain_name: 'Munich Archive',
    look: { palette: 'flint', theme: 'signal', panel_head: 'plain', texture: 'none' },
    copy: {
      home_headline: 'h',
      home_lede: 'l',
      home_intro: 'i',
      about_archive: 'We are the Munich archive.',
      submit_intro: '',
      submit_question: 'What are you reporting?',
      send_note: '',
      refusal_message: 'Something went wrong. Please try again.',
      lock_intro: '',
      terms_of_use: '',
      origin_open_form: 'Unverified public report',
      origin_organization: 'Filed by an organization',
      intake_paused_notice: 'Intake is paused.',
      help_now: 'This is a record, not an emergency line.',
      contact_users: '',
      contact_authorities: '',
      board_intro: '',
      how_intro: '',
      alliance_intro: '',
      standards: 's',
    },
    dev_mode_until: null,
    version: { release: null, build: null },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Renders `ui` at `/` inside a router and a query client that already holds `served`. */
async function inRouter(ui: () => ReactNode, served: Site = site()) {
  vi.stubGlobal('fetch', recordingFetch(served).fetchImpl);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['site'], served);
  const root = createRootRoute({ component: () => <Outlet /> });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: ui });
  const other = createRoute({
    getParentRoute: () => root,
    path: '/about',
    component: () => <h1>Elsewhere</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, other]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
  });
  return router;
}

describe('the footer', () => {
  it('credits the software whatever the site is called, with its source and licence', async () => {
    await inRouter(() => <SiteFooter />);
    const credit = await screen.findByText(/Powered by/);
    expect(credit).toHaveTextContent('Powered by ReportLog, free software under the AGPL-3.0');
    expect(credit).not.toHaveTextContent('Munich');
    expect(screen.getByRole('link', { name: 'ReportLog' })).toHaveAttribute(
      'href',
      'https://github.com/munsdev/reportlog',
    );
  });

  it('a site that names itself "ReportLog" still shows the credit (it is not the site’s name)', async () => {
    await inRouter(
      () => <SiteFooter />,
      site({ name: 'Other', plain_name: 'Other', software_name: 'Renamed by an operator' }),
    );
    expect(await screen.findByRole('link', { name: 'ReportLog' })).toBeInTheDocument();
  });

  it('links the About, How-to, standard, legal, directory, API and journalist pages', async () => {
    await inRouter(() => <SiteFooter />);
    const nav = await screen.findByRole('navigation', { name: 'About this site' });
    const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/about',
      '/how',
      '/standards',
      '/legal',
      '/terms',
      '/illegal-content',
      '/organizations',
      '/public-api',
      '/journalists/alerts',
    ]);
  });

  it('says which release this is, and says nothing where there is no number', async () => {
    expect(versionLine({ release: 'v1.2.0', build: 'abcdef012345' })).toBe(
      'Version v1.2.0 (abcdef012345)',
    );
    expect(versionLine({ release: 'v1.2.0', build: null })).toBe('Version v1.2.0');
    expect(versionLine({ release: null, build: 'abcdef012345' })).toBe('Build abcdef012345');
    expect(versionLine({ release: null, build: null })).toBeNull();
    await inRouter(() => <SiteFooter />, site({ version: { release: 'v3.0.1', build: null } }));
    expect(await screen.findByText('Version v3.0.1')).toBeInTheDocument();
  });
});

describe('the development badge', () => {
  it('is not shown while the notice is off', async () => {
    await inRouter(() => <DevBadge />);
    expect(screen.queryByRole('button', { name: /active development/ })).toBeNull();
  });

  it('is shown while it is on, and explains itself in a dialog', async () => {
    const user = userEvent.setup();
    const until = new Date(Date.now() + 3_600_000).toISOString();
    await inRouter(() => <DevBadge />, site({ dev_mode_until: until }));
    await user.click(await screen.findByRole('button', { name: 'Under active development' }));
    expect(
      screen.getByRole('dialog', { name: 'This site is under active development' }),
    ).toHaveTextContent('Reports you file are not affected');
  });

  it('takes itself down when the window ends, without asking the server again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const until = new Date(Date.now() + 5_000).toISOString();
    await inRouter(() => <DevBadge />, site({ dev_mode_until: until }));
    expect(await screen.findByRole('button', { name: 'Under active development' })).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(screen.queryByRole('button', { name: 'Under active development' })).toBeNull();
  });

  it('wears no status colour: it is a notice, not a verdict', async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    await inRouter(() => <DevBadge />, site({ dev_mode_until: until }));
    const badge = await screen.findByRole('button', { name: 'Under active development' });
    expect(badge.outerHTML).not.toMatch(/confirmed|serious|caution|seal|verify|action/);
  });
});

describe('a slot of page wording', () => {
  it('shows what the operator wrote, as plain text', async () => {
    await inRouter(() => <CopyText slot="about_archive" />);
    expect(await screen.findByText('We are the Munich archive.')).toHaveClass(
      'whitespace-pre-wrap',
    );
  });

  it('an optional slot nobody wrote draws nothing at all', async () => {
    await inRouter(() => (
      <div data-testid="holder">
        <CopyText slot="how_intro" />
      </div>
    ));
    expect((await screen.findByTestId('holder')).innerHTML).toBe('');
  });
});

describe('inserting a number', () => {
  it('goes where the cursor was, or at the end', () => {
    expect(insertAt('Filed: .', '{{ [x] }}', 7)).toEqual({ text: 'Filed: {{ [x] }}.', cursor: 16 });
    expect(insertAt('Filed:', ' {{ [x] }}', null)).toEqual({
      text: 'Filed: {{ [x] }}',
      cursor: 16,
    });
    expect(insertAt('ab', 'X', 99).text).toBe('abX');
  });

  it('is offered for a paragraph, and asks for the figures only when opened', async () => {
    const user = userEvent.setup();
    const answer = {
      figures: [
        {
          id: 'reports.filed.7d',
          group: 'Reports',
          label: 'Reports filed in the last 7 days',
          value: 12,
        },
      ],
    };
    const rec = recordingFetch(answer);
    vi.stubGlobal('fetch', rec.fetchImpl);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SlotEditor
          slot={{
            key: 'how_intro',
            kind: 'block',
            label: 'Your own words on the how-to page',
            help: 'h',
            optional: true,
            fallback: '',
            body: 'This week:',
            written: true,
          }}
        />
      </QueryClientProvider>,
    );
    expect(rec.sent).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Insert a number' }));
    await user.selectOptions(
      await screen.findByLabelText('Which number'),
      'Reports filed in the last 7 days',
    );
    expect(screen.getByText(/It is 12 now/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Insert it' }));
    expect(screen.getByRole('textbox', { name: 'Your own words on the how-to page' })).toHaveValue(
      'This week:{{ [reports.filed.7d] }}',
    );
    expect(rec.sent.map((s) => s.url)).toEqual(['/api/admin/site/figures']);
  });
});

describe('unsaved changes', () => {
  it('the question names everything that would be lost', () => {
    expect(unsavedQuestion(['the look'])).toBe(
      'You have changes to the look that are not saved. Leave without saving them?',
    );
    expect(unsavedQuestion(['the imprint', 'the privacy policy', 'the name'])).toMatch(
      /changes to the imprint, the privacy policy and the name that/,
    );
  });

  function lookScreen(ask: (q: string) => boolean) {
    return () => (
      <UnsavedChangesGuard ask={ask}>
        <LookForm state={editorState()} />
        <Link to="/about">Leave</Link>
      </UnsavedChangesGuard>
    );
  }

  it('leaving with nothing changed asks nothing', async () => {
    const user = userEvent.setup();
    const ask = vi.fn(() => false);
    const router = await inRouter(lookScreen(ask));
    await user.click(screen.getByRole('link', { name: 'Leave' }));
    expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeVisible();
    expect(ask).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/about');
  });

  it('leaving with a change asks once, and staying keeps the change', async () => {
    const user = userEvent.setup();
    const ask = vi.fn(() => false);
    const router = await inRouter(lookScreen(ask));
    await user.click(screen.getByRole('radio', { name: 'Midnight' }));
    await user.click(screen.getByRole('link', { name: 'Leave' }));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(
      'You have changes to the look that are not saved. Leave without saving them?',
    );
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByRole('radio', { name: 'Midnight' })).toBeChecked();
  });

  it('answering yes leaves', async () => {
    const user = userEvent.setup();
    const ask = vi.fn(() => true);
    await inRouter(lookScreen(ask));
    await user.click(screen.getByRole('radio', { name: 'Midnight' }));
    await user.click(screen.getByRole('link', { name: 'Leave' }));
    expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeVisible();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('a change undone by hand is not a change', async () => {
    const user = userEvent.setup();
    const ask = vi.fn(() => false);
    await inRouter(lookScreen(ask));
    await user.click(screen.getByRole('radio', { name: 'Midnight' }));
    await user.click(screen.getByRole('radio', { name: 'Flint' }));
    await user.click(screen.getByRole('link', { name: 'Leave' }));
    expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeVisible();
    expect(ask).not.toHaveBeenCalled();
  });
});
