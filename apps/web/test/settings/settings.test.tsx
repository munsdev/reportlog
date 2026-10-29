/**
 * The site settings screens (settings-and-admin.md §02 to §06, decision 61).
 *
 * THE PROMISES UNDER TEST:
 *   - Look: choosing a look changes the preview and the line above it and
 *     nothing else, sends nothing, and leaves <html> alone; "Apply to the
 *     site" sends palette and theme together, once, with no step-up; "Back
 *     to what the site shows" puts the preview back;
 *   - the preview is the site itself in a frame, told the look by message;
 *   - every setting panel shows what is set before it is opened, and only
 *     one is open at a time;
 *   - a switch sends nothing when its card is chosen, only when its button
 *     is pressed, and says so in a toast;
 *   - the wording page shows each piece in context as it is typed.
 */
import { LOOKS, PALETTES, THEMES } from '@reportlog/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsFrame } from '../../src/features/settings/panels.tsx';
import { AcceptingReportsPanel, DevNoticePanel } from '../../src/features/settings/Switches.tsx';
import { firstLines, groupSlots, withFigures } from '../../src/features/settings/wording.tsx';
import { lookName } from '../../src/features/settings/looks.ts';
import { wordingSummary } from '../../src/routes/(staff)/settings/index.tsx';
import { LegalEditor } from '../../src/routes/(staff)/settings/legal.tsx';
import { LookScreen } from '../../src/routes/(staff)/settings/look.tsx';
import { NameForm, nameProblem } from '../../src/routes/(staff)/settings/name.tsx';
import { SlotEditor } from '../../src/routes/(staff)/settings/words.tsx';
import { WithEditor } from '../../src/routes/(staff)/settings/-editor.tsx';
import { editorState, recordingFetch } from '../site-fixture.ts';

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['site'], {
    software_name: 'ReportLog',
    name: 'Munich',
    name_parts: [{ text: 'Munich', mark: '' }],
    plain_name: 'Munich',
    look: { palette: 'flint', theme: 'signal', panel_head: 'plain', texture: 'none' },
    copy: {},
    dev_mode_until: null,
    version: { release: null, build: null },
  });
  return render(
    <QueryClientProvider client={client}>
      <SettingsFrame>{children}</SettingsFrame>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(answer: unknown = editorState()) {
  const rec = recordingFetch(answer);
  vi.stubGlobal('fetch', rec.fetchImpl);
  return rec.sent;
}

/** A fetch answering by method and path, recording every write. */
function serve(answers: Record<string, unknown>) {
  const sent: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? 'GET';
    sent.push({
      method,
      url,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const answer = answers[`${method} ${url.split('?')[0] ?? ''}`];
    return Promise.resolve(
      answer === undefined
        ? new Response('{}', { status: 404 })
        : new Response(JSON.stringify(answer), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
    );
  });
  return sent;
}
const writes = (sent: { method: string }[]) => sent.filter((s) => s.method !== 'GET');

/** A logbook as the admin list sends it, in the given state. */
const logbook = (id: number, state: 'draft' | 'open' | 'closed') => ({
  id,
  slug: `lb-${String(id)}`,
  title: `Logbook ${String(id)}`,
  blurb: null,
  state,
  launched_at: state === 'draft' ? null : '2026-10-19T10:00:00.000Z',
  opens_at: null,
  closes_at: null,
  closed_at: state === 'closed' ? '2026-10-20T10:00:00.000Z' : null,
  created_at: '2026-10-19T09:00:00.000Z',
  updated_at: '2026-10-19T10:00:00.000Z',
  question_count: 2,
  asks_for_files: false,
  files_frozen_at: null,
  outside_access: 'closed',
  email_required: false,
  email_optional: false,
  accepts_notes: false,
  publish_by_terms: false,
  show_on_front: true,
  short_slug: null,
  asks_email: true,
});

/**
 * The preview frame for a device: the site itself, which is handed the look
 * by a message (LivePreview.tsx). jsdom does not deliver a message to a frame
 * with another origin, so what the frame was told is read from the spy.
 */
function previewFrame(device: 'desktop' | 'phone' = 'desktop') {
  const f = document.querySelector(`iframe[title="The page on a ${device}"]`);
  if (!(f instanceof HTMLIFrameElement) || !f.contentWindow) throw new Error(`no ${device} frame`);
  const told = vi.spyOn(f.contentWindow, 'postMessage').mockImplementation(() => undefined);
  return { frame: f, told };
}

/** The panel around a heading (a panel is a plain section, named by its heading). */
function panelOf(title: string): HTMLElement {
  const panel = screen.getByRole('heading', { name: title }).closest('section');
  if (!panel) throw new Error(`no panel called ${title}`);
  return panel;
}

/** A narrow screen: no min-width query matches (the setup file's default is a wide one). */
function narrowScreen() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

describe('the look screen', () => {
  it('previews a chosen look in both frames, and changes nothing else until Apply', async () => {
    const user = userEvent.setup();
    const sent = stubFetch(editorState({ look: { palette: 'newsprint', theme: 'broadsheet' } }));
    wrap(<LookScreen state={editorState()} />);
    const { told } = previewFrame();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('The site is showing Civic.');
    expect(screen.queryByRole('button', { name: 'Apply to the site' })).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Morning edition' }));
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(
      'Preview only. The site is still showing Civic. You are previewing Morning edition.',
    );
    expect(told).toHaveBeenLastCalledWith(
      { type: 'rl-look', look: { palette: 'newsprint', theme: 'broadsheet' } },
      window.location.origin,
    );
    // The page the administrator is on does not repaint, and nothing is sent.
    expect(document.documentElement).not.toHaveAttribute('data-palette', 'newsprint');
    expect(writes(sent)).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Apply to the site' }));
    expect(writes(sent)).toEqual([
      {
        url: '/api/admin/site/look',
        method: 'PUT',
        body: { palette: 'newsprint', theme: 'broadsheet' },
      },
    ]);
    expect(await screen.findByText('The new look is live.')).toBeInTheDocument();
  });

  it('goes back to what the site shows', async () => {
    const user = userEvent.setup();
    const sent = stubFetch();
    wrap(<LookScreen state={editorState()} />);
    const { told } = previewFrame();
    await user.click(screen.getByRole('radio', { name: 'Green screen' }));
    await user.click(screen.getByRole('button', { name: 'Back to what the site shows' }));
    expect(screen.getByRole('radio', { name: /^Civic\s*On the site$/ })).toBeChecked();
    expect(told).toHaveBeenLastCalledWith(
      { type: 'rl-look', look: { palette: 'flint', theme: 'signal' } },
      window.location.origin,
    );
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('The site is showing Civic.');
    expect(writes(sent)).toEqual([]);
  });

  it('marks the look on the site, and shows a named look as chosen when its two parts are', async () => {
    const user = userEvent.setup();
    stubFetch();
    wrap(<LookScreen state={editorState()} />);
    expect(screen.getByRole('radio', { name: /^Civic\s*On the site$/ })).toBeChecked();
    await user.selectOptions(screen.getByLabelText('Palette'), 'midnight');
    // Midnight with Signal is "Civic at night".
    expect(screen.getByRole('radio', { name: 'Civic at night' })).toBeChecked();
    await user.selectOptions(screen.getByLabelText('Theme'), 'docket');
    expect(screen.queryByRole('radio', { checked: true })).toBeNull();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(
      'You are previewing Midnight with Docket.',
    );
  });

  it('offers every named look, palette and theme', () => {
    stubFetch();
    wrap(<LookScreen state={editorState()} />);
    expect(
      within(screen.getByRole('radiogroup', { name: 'Named looks' })).getAllByRole('radio'),
    ).toHaveLength(LOOKS.length);
    expect(within(screen.getByLabelText('Palette')).getAllByRole('option')).toHaveLength(
      PALETTES.length,
    );
    expect(within(screen.getByLabelText('Theme')).getAllByRole('option')).toHaveLength(
      THEMES.length,
    );
    expect(screen.getByRole('option', { name: 'Midnight · dark' })).toBeInTheDocument();
  });

  it('shows the site itself in the frame, and tells it the look again whenever it says it is listening', () => {
    stubFetch();
    wrap(<LookScreen state={editorState()} />);
    const { frame, told } = previewFrame();
    // Not a copy of the page: the real front page, so whatever the page
    // script paints is in the preview too.
    expect(frame).toHaveAttribute('src', '/');
    expect(frame.name).toBe('rl-look-preview');
    told.mockClear();
    // A navigation inside the frame reloads it; it says so and hears the look again.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'rl-look-ready' },
          origin: window.location.origin,
          source: frame.contentWindow,
        }),
      );
    });
    expect(told).toHaveBeenCalledWith(
      { type: 'rl-look', look: { palette: 'flint', theme: 'signal' } },
      window.location.origin,
    );
    // Only the same origin, and only that frame, is listened to.
    told.mockClear();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'rl-look-ready' },
          origin: 'https://elsewhere.example',
          source: frame.contentWindow,
        }),
      );
    });
    expect(told).not.toHaveBeenCalled();
  });

  it('shows one frame, a desktop or a phone, and switches between them on a press', async () => {
    const user = userEvent.setup();
    stubFetch();
    wrap(<LookScreen state={editorState()} />);
    const choose = within(screen.getByRole('group', { name: 'Preview on' }));
    expect(choose.getByRole('button', { name: 'Desktop' })).toHaveAttribute('aria-pressed', 'true');
    expect(choose.getByRole('button', { name: 'Phone' })).toHaveAttribute('aria-pressed', 'false');
    expect(previewFrame('desktop').frame).toBeInTheDocument();
    expect(document.querySelector('iframe[title="The page on a phone"]')).toBeNull();
    await user.click(choose.getByRole('button', { name: 'Phone' }));
    expect(choose.getByRole('button', { name: 'Phone' })).toHaveAttribute('aria-pressed', 'true');
    expect(previewFrame('phone').frame).toBeInTheDocument();
    expect(document.querySelector('iframe[title="The page on a desktop"]')).toBeNull();
  });

  it('is one radio group of looks on a desktop, with no bar pinned to the screen', () => {
    stubFetch();
    wrap(<LookScreen state={editorState()} />);
    expect(screen.getAllByRole('radiogroup', { name: /^Named looks/ })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Pick a look' })).toBeNull();
  });

  it('on a narrow screen keeps the one radio group of looks that previews, and moves the decision to the foot', async () => {
    narrowScreen();
    try {
      const user = userEvent.setup();
      const sent = stubFetch();
      wrap(<LookScreen state={editorState()} />);
      // The mock-up has no second "quick pick" bar: the one chooser serves both.
      expect(screen.queryByRole('region', { name: 'Pick a look' })).toBeNull();
      expect(screen.getAllByRole('radiogroup', { name: /^Named looks/ })).toHaveLength(1);
      expect(screen.getByLabelText('Palette')).toBeInTheDocument();
      // Nothing to decide until a look is chosen; then the decision is pinned at the foot.
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();

      await user.click(
        within(screen.getByRole('radiogroup', { name: 'Named looks' })).getByRole('radio', {
          name: 'Green screen',
        }),
      );
      expect(screen.getAllByRole('status')[0]).toHaveTextContent(
        'You are previewing Green screen.',
      );
      expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
      // Choosing sends nothing.
      expect(writes(sent)).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('names a pair nobody named by its two parts', () => {
    expect(lookName({ palette: 'platinum', theme: 'desk' })).toBe('Desk');
    expect(lookName({ palette: 'midnight', theme: 'docket' })).toBe('Midnight with Docket');
  });
});

describe('the name screen', () => {
  it('previews the marks on the header’s bar and on the page', async () => {
    const user = userEvent.setup();
    stubFetch();
    wrap(<NameForm state={editorState()} />);
    await user.type(screen.getByLabelText('The site’s name'), 'Munich"Log"');
    const [onBar, onPage] = screen.getAllByText('Log');
    // On the bar the first accent run is the wordmark's <b>.
    expect(onBar?.tagName).toBe('B');
    expect(onBar?.closest('.wm')).toHaveTextContent(/^MunichLog$/);
    expect(onPage?.className).toMatch(/text-brand(?!-)/);
    // The marks are never shown: the preview reads as the plain name.
    expect(onPage?.closest('p')).toHaveTextContent(/MunichLog$/);
  });

  it('says what is wrong with an unclosed quote before anything is sent', async () => {
    const user = userEvent.setup();
    const sent = stubFetch();
    wrap(<NameForm state={editorState()} />);
    await user.type(screen.getByLabelText('The site’s name'), 'Munich"Log');
    expect(screen.getByLabelText('The site’s name')).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(sent).toEqual([]);
    expect(nameProblem(`Sam's Archive`)).toBeNull();
  });

  it('shows the Save bar only with a change, and sends null when the box is cleared', async () => {
    const user = userEvent.setup();
    const sent = stubFetch(editorState());
    wrap(<NameForm state={editorState({ name: 'Munich', effective_name: 'Munich' })} />);
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();
    await user.clear(screen.getByLabelText('The site’s name'));
    const bar = screen.getByRole('region', { name: 'Unsaved changes' });
    expect(bar).toHaveTextContent('Changes to This site’s name are not saved.');
    await user.click(within(bar).getByRole('button', { name: 'Save' }));
    expect(sent[0]?.body).toEqual({ name: null });
    expect(await screen.findByText('The new name is live.')).toBeInTheDocument();
  });
});

describe('the wording screen', () => {
  const slot = () => {
    const s = editorState().copy[0];
    if (!s) throw new Error('fixture');
    return s;
  };

  it('shows each piece closed, with what it says and that it is the shipped wording', () => {
    stubFetch();
    wrap(<SlotEditor slot={slot()} />);
    const panel = panelOf('Front page headline');
    expect(panel).toHaveTextContent('A record of what happened.');
    expect(panel).toHaveTextContent('Shipped wording');
    expect(screen.queryByRole('textbox', { name: 'Front page headline' })).toBeNull();
  });

  it('opens to its editor and the piece in context, and saves one slot from the Save bar', async () => {
    const user = userEvent.setup();
    const sent = stubFetch();
    wrap(<SlotEditor slot={slot()} />);
    await user.click(screen.getByRole('button', { name: 'Edit Front page headline' }));
    const box = screen.getByRole('textbox', { name: 'Front page headline' });
    expect(box).toHaveAccessibleDescription(/still the wording the site ships with/);
    await user.clear(box);
    await user.type(box, 'Our archive.');
    const picture = screen.getByText(/Preview · on the page: Front page/).closest('.panel');
    expect(picture).toHaveTextContent('Our archive.');
    await user.click(
      within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', {
        name: 'Save',
      }),
    );
    expect(writes(sent)).toEqual([
      { url: '/api/admin/site/copy/home_headline', method: 'PUT', body: { body: 'Our archive.' } },
    ]);
  });

  it('shows an empty piece as a dashed space, and a figure as its number', () => {
    expect(
      withFigures('Filed: {{ [reports.filed.all] }}', new Map([['reports.filed.all', 1204]])),
    ).toBe('Filed: 1,204');
    expect(withFigures('{{ round([a] / 2, 1) }}', null)).toBe('#');
    expect(firstLines('One\n\nTwo\nThree')).toBe('One Two…');
    expect(groupSlots(editorState().copy).map((g) => g.page)).toEqual(['Front page']);
  });
});

describe('the legal notices screen', () => {
  it('says the outline is not a notice, and offers no take-down for what is not up', async () => {
    const user = userEvent.setup();
    stubFetch();
    const entry = editorState().legal[0];
    if (!entry) throw new Error('fixture');
    wrap(<LegalEditor entry={entry} />);
    expect(panelOf('Imprint')).toHaveTextContent('Outline only, not published');
    await user.click(screen.getByRole('button', { name: 'Edit Imprint' }));
    expect(
      screen.getByText(/Saving it as it stands would publish the outline/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take it down' })).not.toBeInTheDocument();
  });

  it('takes a published notice down by saving it empty', async () => {
    const user = userEvent.setup();
    const sent = stubFetch();
    const entry = editorState().legal[1];
    if (!entry) throw new Error('fixture');
    wrap(<LegalEditor entry={entry} />);
    await user.click(screen.getByRole('button', { name: 'Edit Privacy policy' }));
    await user.click(screen.getByRole('button', { name: 'Take it down' }));
    expect(sent).toEqual([
      { url: '/api/admin/site/legal/privacy', method: 'PUT', body: { text: '' } },
    ]);
  });

  it('opens one panel at a time, and asks before leaving changes in the open one', async () => {
    const user = userEvent.setup();
    stubFetch();
    const [imprint, privacy] = editorState().legal;
    if (!imprint || !privacy) throw new Error('fixture');
    wrap(
      <>
        <LegalEditor entry={imprint} />
        <LegalEditor entry={privacy} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Edit Imprint' }));
    await user.type(screen.getByRole('textbox', { name: 'Imprint' }), ' more');
    await user.click(screen.getByRole('button', { name: 'Edit Privacy policy' }));
    expect(
      await screen.findByRole('dialog', { name: 'Leave your changes to Imprint?' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Leave them' }));
    expect(screen.getByRole('textbox', { name: 'Privacy policy' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Imprint' })).toBeNull();
  });
});

describe('the settings overview', () => {
  it('counts the wording changed from what ships, and the newest change', () => {
    const copy = [
      ...editorState().copy,
      {
        ...editorState().copy[0],
        key: 'home_lede' as const,
        written: true,
        changed_at: '2026-10-20T09:00:00.000Z',
      },
    ] as ReturnType<typeof editorState>['copy'];
    const [changed, last] = wordingSummary(copy);
    expect(changed?.value).toBe('1 of 2');
    expect(last?.value).toMatch(/20/);
  });

  it('accepting reports: choosing a card sends nothing; the button does, and a toast says so', async () => {
    const sent = serve({
      'GET /api/admin/intake-switch': { open: true, stored: null },
      'PUT /api/admin/intake-switch': { open: false, stored: false },
      'GET /api/intake-pause': { paused: false, since: null, notice: '' },
      'GET /api/admin/logbooks': {
        logbooks: [logbook(1, 'open'), logbook(2, 'closed'), logbook(3, 'draft')],
      },
    });
    const user = userEvent.setup();
    wrap(<AcceptingReportsPanel />);
    const panel = panelOf('Accepting reports');
    await screen.findByRole('switch', { name: 'Taking new reports' });
    await waitFor(() => {
      expect(panel).toHaveTextContent('Logbooks open1 of 2');
    });
    expect(panel).toHaveTextContent('Paused by the flood screenNo');
    expect(screen.getByText(/Nobody has set this/)).toBeInTheDocument();
    // Switching it off asks first; nothing is sent until that is confirmed.
    await user.click(screen.getByRole('switch', { name: 'Taking new reports' }));
    expect(await screen.findByRole('dialog', { name: 'Stop taking new reports?' })).toBeVisible();
    expect(writes(sent)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Turn it off' }));
    expect(writes(sent)).toEqual([
      { method: 'PUT', url: '/api/admin/intake-switch', body: { open: false } },
    ]);
    expect(await screen.findByText('Accepting reports is now off.')).toBeInTheDocument();
  });

  it('accepting reports: a closed site opens with its card and one press', async () => {
    const sent = serve({
      'GET /api/admin/intake-switch': { open: false, stored: false },
      'PUT /api/admin/intake-switch': { open: true, stored: true },
      'GET /api/intake-pause': { paused: true, since: '2026-10-21T10:00:00.000Z', notice: 'x' },
      'GET /api/admin/logbooks': { logbooks: [] },
    });
    const user = userEvent.setup();
    wrap(<AcceptingReportsPanel />);
    const toggle = await screen.findByRole('switch', { name: 'Taking new reports' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    // Switching it on is not a risk, so it applies at once, with no question.
    await user.click(toggle);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes(sent)).toEqual([
      { method: 'PUT', url: '/api/admin/intake-switch', body: { open: true } },
    ]);
    expect(await screen.findByText('Accepting reports is now on.')).toBeInTheDocument();
  });

  it('the development notice: off now, said in a toast', async () => {
    const sent = serve({
      'PUT /api/admin/site/dev-mode': {
        active: false,
        until: null,
        default_hours: 6,
        max_hours: 72,
      },
    });
    const user = userEvent.setup();
    wrap(
      <DevNoticePanel
        state={{ active: true, until: '2026-10-22T18:00:00.000Z', default_hours: 6, max_hours: 72 }}
      />,
    );
    // The switch applies the moment it is pressed.
    await act(async () => {
      await user.click(screen.getByRole('switch', { name: /^On until/ }));
    });
    expect(writes(sent)).toEqual([
      { method: 'PUT', url: '/api/admin/site/dev-mode', body: { hours: null } },
    ]);
    expect(await screen.findByText('The development notice is now off.')).toBeInTheDocument();
  });
});

describe('a settings screen the server will not open', () => {
  it('says so in words', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'forbidden', message: 'No.' } }), {
          status: 403,
        }),
      ),
    );
    wrap(<WithEditor>{() => <p>Opened</p>}</WithEditor>);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an administrator can change these settings.',
    );
  });
});
