/**
 * The files staff screens (F2): a moderator deciding on a report's files and
 * asking for evidence, and an administrator's limits.
 *
 * THE PROMISES UNDER TEST:
 *   - consent is the ceiling: publishing is never offered past the reporter's
 *     sealed answer, their file permission, or a withdrawal, while keeping a
 *     file unpublished and refusing it always are;
 *   - one card asks one question, and moving on is the moderator's own press;
 *   - an empty limit box means "the one underneath", and is sent as a clear.
 */
import type { FileLimitLayers, ThreadFile } from '@reportlog/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvidenceRequests } from '../src/features/files/staff/EvidenceRequests.tsx';
import { LimitsForm } from '../src/features/files/staff/LimitsForm.tsx';
import { ReportFiles } from '../src/features/files/staff/ReportFiles.tsx';
import { fromBox, whyNotPublishable } from '../src/features/files/staff/words.ts';

const THREAD = '00000000-0000-4000-8000-000000000001';
const FILE: ThreadFile = {
  id: 7,
  ordinal: 1,
  original_name: 'queue.jpg',
  media_type: 'image/jpeg',
  byte_size: 2 * 1024 * 1024,
  sha256: 'a'.repeat(64),
  rendition_media_type: 'image/jpeg',
  publication: 'withheld',
  alt_text: null,
  erased: false,
  has_poster: false,
  pages: 1,
  duration_seconds: null,
  received_at: '2026-10-19T10:00:00.000Z',
};

interface Sent {
  method: string;
  url: string;
  body: unknown;
}

/** A fetch answering by path, recording every call. */
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
      const answer = key in answers ? answers[key] : { ok: true };
      return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
    }),
  );
  return sent;
}

const wrap = (node: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {node}
    </QueryClientProvider>,
  );

const threadFiles = (over: Record<string, unknown> = {}, file: Partial<ThreadFile> = {}) => ({
  [`GET /api/moderate/files/${THREAD}`]: {
    may_publish: true,
    files_permitted: true,
    withdrawn: false,
    files: [{ ...FILE, ...file }],
    events: [],
    ...over,
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('consent is the ceiling', () => {
  it('in words, for each gate', () => {
    const yes = { may_publish: true, files_permitted: true, withdrawn: false };
    expect(whyNotPublishable(FILE, yes)).toBeNull();
    expect(whyNotPublishable(FILE, { ...yes, may_publish: false })).toMatch(/did not agree/);
    expect(whyNotPublishable(FILE, { ...yes, files_permitted: false })).toMatch(/Only they/);
    expect(whyNotPublishable(FILE, { ...yes, withdrawn: true })).toMatch(/withdrew/);
    expect(whyNotPublishable({ ...FILE, erased: true }, yes)).toMatch(/erased/);
  });

  it('a reporter who has not allowed their files: no Publish button, the reason instead, and withholding still offered', async () => {
    serve(threadFiles({ files_permitted: false }));
    wrap(<ReportFiles threadId={THREAD} />);
    expect(await screen.findByRole('heading', { name: /queue\.jpg/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish/ })).toBeNull();
    expect(screen.getAllByText(/Only they can change that/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Keep it unpublished…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refuse…' })).toBeInTheDocument();
  });

  it('a report the reporter did not allow published, or withdrew: no Publish button either', async () => {
    serve(threadFiles({ may_publish: false }));
    const one = wrap(<ReportFiles threadId={THREAD} />);
    await screen.findByRole('heading', { name: /queue\.jpg/ });
    expect(screen.queryByRole('button', { name: /Publish/ })).toBeNull();
    one.unmount();
    vi.unstubAllGlobals();
    serve(threadFiles({ withdrawn: true }));
    wrap(<ReportFiles threadId={THREAD} />);
    await screen.findByRole('heading', { name: /queue\.jpg/ });
    expect(screen.queryByRole('button', { name: /Publish/ })).toBeNull();
    expect(screen.getByText('The reporter withdrew this report')).toBeInTheDocument();
  });

  it('a published file can still be taken down when the gates have since shut', async () => {
    serve(
      threadFiles({ files_permitted: false }, { publication: 'published', alt_text: 'A queue' }),
    );
    wrap(<ReportFiles threadId={THREAD} />);
    expect(await screen.findByRole('button', { name: 'Take it down…' })).toBeInTheDocument();
  });
});

describe('one card asks one question', () => {
  it('publishing asks for the description, then the reason, each on its own, and sends both', async () => {
    const user = userEvent.setup();
    const sent = serve(threadFiles());
    wrap(<ReportFiles threadId={THREAD} />);
    await user.click(await screen.findByRole('button', { name: 'Publish…' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Question 1 of 2')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Why publish it?')).toBeNull();

    // Nothing moves on by itself, and not without an answer.
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByText(/A description is needed/)).toBeInTheDocument();
    await user.type(
      within(dialog).getByLabelText('Describe the file for somebody who cannot see it'),
      'A queue at a door',
    );
    expect(within(dialog).getByText('Question 1 of 2')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));

    expect(within(dialog).getByText('Question 2 of 2')).toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText('Describe the file for somebody who cannot see it'),
    ).toBeNull();
    await user.type(within(dialog).getByLabelText('Why publish it?'), 'It shows the queue');
    await user.click(within(dialog).getByRole('button', { name: 'Publish this file' }));

    const post = sent.find((s) => s.method === 'POST');
    expect(post?.url).toBe('/api/moderate/files/file/7/publication');
    expect(post?.body).toEqual({
      publication: 'published',
      alt_text: 'A queue at a door',
      reason: 'It shows the queue',
    });
  });

  it('opening the original asks why first, and the link carries the reason', async () => {
    const user = userEvent.setup();
    serve(threadFiles());
    wrap(<ReportFiles threadId={THREAD} />);
    await user.click(await screen.findByRole('button', { name: 'Open the original…' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('link')).toBeNull();
    await user.type(
      within(dialog).getByLabelText('Why do you need the original?'),
      'To check the date it was taken',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    const link = within(dialog).getByRole('link', { name: 'Download the original' });
    expect(link.getAttribute('href')).toBe(
      '/api/moderate/files/file/7/original?reason=To+check+the+date+it+was+taken',
    );
  });
});

describe('asking for evidence', () => {
  const state = (over: Record<string, unknown>) => ({
    [`GET /api/moderate/evidence/${THREAD}`]: {
      askable: false,
      why_not: null,
      declared: true,
      permitted: true,
      open: null,
      history: [],
      ...over,
    },
  });

  it('the server’s reason, and no button, when the reporter cannot be asked', async () => {
    serve(state({ why_not: 'The reporter has not agreed to be asked.', permitted: false }));
    wrap(<EvidenceRequests threadId={THREAD} />);
    expect(await screen.findByText('The reporter has not agreed to be asked.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ask for evidence/ })).toBeNull();
  });

  it('asks with the moderator’s own words, and refuses a blank one', async () => {
    const user = userEvent.setup();
    const sent = serve(state({ askable: true }));
    wrap(<EvidenceRequests threadId={THREAD} />);
    await user.click(await screen.findByRole('button', { name: 'Ask for evidence…' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Send the ask' }));
    expect(within(dialog).getByText(/Write at least a sentence/)).toBeInTheDocument();
    expect(sent.some((s) => s.method === 'POST')).toBe(false);
    await user.type(
      within(dialog).getByLabelText('What are you asking them for?'),
      'Could you send the photo of the queue?',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Send the ask' }));
    expect(sent.find((s) => s.method === 'POST')?.body).toEqual({
      message: 'Could you send the photo of the queue?',
    });
  });
});

describe('limits', () => {
  const MB = 1024 * 1024;
  const row = (
    shipped: number,
    site: number | null = null,
    logbook: number | null = null,
  ): FileLimitLayers['maxFiles'] => ({
    logbook,
    site,
    shipped,
    effective: logbook ?? site ?? shipped,
    source: logbook !== null ? 'logbook' : site !== null ? 'site' : 'shipped',
  });
  const LAYERS: FileLimitLayers = {
    maxImageBytes: row(25 * MB, 10 * MB),
    maxVideoBytes: row(150 * MB),
    maxAudioBytes: row(60 * MB),
    maxDocumentBytes: row(30 * MB),
    maxVideoSeconds: row(180),
    maxDocumentPages: row(40),
    maxFiles: row(10),
    maxTotalBytes: row(400 * MB),
    kinds: {
      logbook: null,
      site: ['photo', 'video'],
      shipped: ['photo', 'video', 'audio', 'document'],
      effective: ['photo', 'video'],
      source: 'site',
    },
  };

  it('megabytes in, bytes out; empty is a clear', () => {
    expect(fromBox('', 'mb')).toBeNull();
    expect(fromBox(' 12 ', 'mb')).toBe(12 * MB);
    expect(fromBox('30', 'n')).toBe(30);
    expect(fromBox('1.5', 'mb')).toBeNaN();
  });

  it('a logbook’s boxes start empty with the site’s number underneath, and saving sends exactly what is typed', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(() => Promise.resolve());
    render(<LimitsForm layers={LAYERS} mine="logbook" onSave={onSave} />);
    const photo = screen.getByLabelText('Largest photo (MB)');
    expect(photo).toHaveValue('');
    expect(photo).toHaveAttribute('placeholder', '10');
    expect(screen.getByText('From the site: 10 MB.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Most files on one report (files)'), 'many');
    await user.click(screen.getByRole('button', { name: 'Save the limits' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/whole number/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Most files on one report (files)'));
    await user.type(screen.getByLabelText('Most files on one report (files)'), '3');
    await user.type(photo, '5');
    await user.click(screen.getByRole('button', { name: 'Save the limits' }));
    expect(onSave).toHaveBeenCalledWith({
      maxImageBytes: 5 * MB,
      maxVideoBytes: null,
      maxAudioBytes: null,
      maxDocumentBytes: null,
      maxVideoSeconds: null,
      maxDocumentPages: null,
      maxFiles: 3,
      maxTotalBytes: null,
      kinds: null,
    });
    expect(await screen.findByText(/Saved/)).toBeInTheDocument();
  });

  it('a number out of range is said in the box’s own unit', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(() => Promise.resolve());
    render(<LimitsForm layers={LAYERS} mine="site" onSave={onSave} />);
    await user.type(screen.getByLabelText('Most files on one report (files)'), '500');
    await user.click(screen.getByRole('button', { name: 'Save the limits' }));
    expect(screen.getByText('Between 1 and 50 files.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
