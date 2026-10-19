import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LegalEditor } from '../../src/routes/(staff)/settings/legal.tsx';
import { LookForm } from '../../src/routes/(staff)/settings/look.tsx';
import { NameForm, nameProblem } from '../../src/routes/(staff)/settings/name.tsx';
import { SlotEditor } from '../../src/routes/(staff)/settings/words.tsx';
import { WithEditor } from '../../src/routes/(staff)/settings/-editor.tsx';
import { editorState, recordingFetch } from '../site-fixture.ts';

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(answer: unknown = editorState()) {
  const rec = recordingFetch(answer);
  vi.stubGlobal('fetch', rec.fetchImpl);
  return rec.sent;
}

describe('the look screen', () => {
  it('changes nothing until Save, then sends both axes', async () => {
    const user = userEvent.setup();
    const sent = stubFetch();
    wrap(<LookForm state={editorState()} />);
    const save = screen.getByRole('button', { name: 'Save the look' });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'Midnight' }));
    await user.click(screen.getByRole('radio', { name: 'Docket' }));
    expect(sent).toEqual([]);
    expect(document.documentElement).not.toHaveAttribute('data-palette', 'midnight');

    await user.click(save);
    expect(sent).toEqual([
      {
        url: '/api/admin/site/look',
        method: 'PUT',
        body: { palette: 'midnight', theme: 'docket' },
      },
    ]);
    expect(await screen.findByRole('status')).toHaveTextContent('The new look is live.');
  });

  it('offers every palette and theme, each named and described', () => {
    wrap(<LookForm state={editorState()} />);
    expect(
      within(screen.getByRole('radiogroup', { name: 'Palette' })).getAllByRole('radio'),
    ).toHaveLength(18);
    expect(
      within(screen.getByRole('radiogroup', { name: 'Theme' })).getAllByRole('radio'),
    ).toHaveLength(6);
    expect(screen.getByRole('radio', { name: 'Midnight' })).toHaveAccessibleDescription(/Dark\./);
  });
});

describe('the name screen', () => {
  it('previews the marks as the header will draw them', async () => {
    const user = userEvent.setup();
    stubFetch();
    wrap(<NameForm state={editorState()} />);
    await user.type(screen.getByLabelText('The site’s name'), 'Munich"Log"');
    const accent = screen.getByText('Log');
    expect(accent.className).toMatch(/text-brand-on-deep/);
    // The marks are never shown: the preview reads as the plain name.
    expect(accent.closest('p')).toHaveTextContent(/^MunichLog$/);
  });

  it('says what is wrong with an unclosed quote before anything is sent', async () => {
    const user = userEvent.setup();
    const sent = stubFetch();
    wrap(<NameForm state={editorState()} />);
    await user.type(screen.getByLabelText('The site’s name'), 'Munich"Log');
    expect(screen.getByLabelText('The site’s name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save the name' })).toBeDisabled();
    expect(sent).toEqual([]);
    expect(nameProblem(`Sam's Archive`)).toBeNull();
  });

  it('sends null when the box is cleared, which goes back to the default', async () => {
    const user = userEvent.setup();
    const sent = stubFetch();
    wrap(<NameForm state={editorState({ name: 'Munich', effective_name: 'Munich' })} />);
    await user.clear(screen.getByLabelText('The site’s name'));
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(sent[0]?.body).toEqual({ name: null });
  });
});

describe('the page wording screen', () => {
  it('says when a slot still carries the shipped wording, and saves one slot', async () => {
    const user = userEvent.setup();
    const sent = stubFetch();
    const slot = editorState().copy[0];
    if (!slot) throw new Error('fixture');
    wrap(<SlotEditor slot={slot} />);
    const box = screen.getByLabelText('Front page headline');
    expect(box).toHaveAccessibleDescription(/still the wording the site ships with/);
    await user.clear(box);
    await user.type(box, 'Our archive.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(sent).toEqual([
      { url: '/api/admin/site/copy/home_headline', method: 'PUT', body: { body: 'Our archive.' } },
    ]);
  });
});

describe('the legal notices screen', () => {
  it('warns that the outline is not a notice, and offers no take-down for what is not up', () => {
    const entry = editorState().legal[0];
    if (!entry) throw new Error('fixture');
    wrap(<LegalEditor entry={entry} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      /Saving it as it stands would publish the outline/,
    );
    expect(screen.queryByRole('button', { name: 'Take it down' })).not.toBeInTheDocument();
  });

  it('takes a published notice down by saving it empty', async () => {
    const user = userEvent.setup();
    const sent = stubFetch();
    const entry = editorState().legal[1];
    if (!entry) throw new Error('fixture');
    wrap(<LegalEditor entry={entry} />);
    await user.click(screen.getByRole('button', { name: 'Take it down' }));
    expect(sent).toEqual([
      { url: '/api/admin/site/legal/privacy', method: 'PUT', body: { text: '' } },
    ]);
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
