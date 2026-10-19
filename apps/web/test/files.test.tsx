/**
 * The files pieces of the website: what the page refuses before uploading
 * (a kindness; the server decides), and how a public report's files are
 * shown.
 */
import type { UploadConfig } from '@reportlog/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublishedFiles } from '../src/features/files/PublishedFiles.tsx';
import { refusalFor } from '../src/features/files/uploader.ts';

const CONFIG: UploadConfig = {
  enabled: true,
  kinds: ['photo'],
  accept: ['image/jpeg', 'image/png'],
  max_files: 2,
  max_total_bytes: 3 * 1024 * 1024,
  max_bytes: { photo: 2 * 1024 * 1024, video: 0, audio: 0, document: 0 },
  max_video_seconds: 180,
  max_document_pages: 40,
};
const MB = 1024 * 1024;
const kept = (sizes: number[]) =>
  sizes.map((size, id) => ({
    id,
    name: `f${String(id)}`,
    size,
    slot: 's',
    status: 'uploaded',
    progress: 100,
    error: null,
  }));

describe('what the page refuses before sending', () => {
  it('a kind the form does not take, a file too large, too many, too much together', () => {
    expect(refusalFor({ name: 'a.mp4', type: 'video/mp4', size: 10 }, CONFIG, [])).toMatch(
      /not a kind/,
    );
    expect(refusalFor({ name: 'a.jpg', type: 'image/jpeg', size: 3 * MB }, CONFIG, [])).toMatch(
      /larger than 2.0 MB/,
    );
    expect(
      refusalFor({ name: 'a.jpg', type: 'image/jpeg', size: 10 }, CONFIG, kept([1, 1])),
    ).toMatch(/at most 2 files/);
    expect(
      refusalFor({ name: 'a.jpg', type: 'image/jpeg', size: 2 * MB }, CONFIG, kept([1.5 * MB])),
    ).toMatch(/Together/);
    expect(
      refusalFor({ name: 'a.jpg', type: 'image/jpeg', size: MB }, CONFIG, kept([MB])),
    ).toBeNull();
  });

  it('a form taking one file says so, rather than "at most 1 files"', () => {
    expect(
      refusalFor(
        { name: 'b.jpg', type: 'image/jpeg', size: 1 },
        { ...CONFIG, max_files: 1 },
        kept([1]),
      ),
    ).toMatch(/takes one file/);
  });
});

describe('a public report’s files', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says how many were attached and how many published, and shows the published copies from this site', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              attached: 3,
              published: [
                {
                  ordinal: 1,
                  sha256: 'a'.repeat(64),
                  media_type: 'image/jpeg',
                  alt_text: 'A queue at a door',
                  key: 'b'.repeat(32),
                  has_poster: false,
                  pages: 1,
                },
                {
                  ordinal: 2,
                  sha256: 'c'.repeat(64),
                  media_type: 'image/jpeg',
                  alt_text: 'A letter',
                  key: 'd'.repeat(32),
                  has_poster: false,
                  pages: 2,
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PublishedFiles publicRef="RL-1" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('3 files attached, 2 published.')).toBeInTheDocument();
    const img = screen.getByRole('img', { name: 'A queue at a door' });
    expect(img.getAttribute('src')).toBe(`/api/files/public/${'b'.repeat(32)}`);
    expect(screen.getByRole('img', { name: 'A letter (page 2)' }).getAttribute('src')).toBe(
      `/api/files/public/${'d'.repeat(32)}/page/2`,
    );
  });
});
