/**
 * P3: the line beside every number. One component shows it, the API serves
 * the one constant, and each kind of figure is checked to show it.
 *
 * The figures are: the board's numbers, the maps, a list's counts (API only:
 * no page, so the API test in apps/api/test/db/not-a-sample.test.ts holds
 * that one), the press page and the digest email (also API tests).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NOT_A_SAMPLE } from '@reportlog/contracts';
import type { PublishedMap, ResponseOf, getBoardStats } from '@reportlog/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { NotASample } from '../src/components/ui/not-a-sample.tsx';
import { NumbersPage } from '../src/features/board/Numbers.tsx';
import { PressPage, pressQuery } from '../src/features/board/Press.tsx';
import { boardStatsQuery } from '../src/features/board/queries.ts';
import { HeatMapView } from '../src/features/maps/HeatMap.tsx';
import outlinesText from '../src/features/maps/outlines.json?raw';
import type { Outlines } from '../src/features/maps/outlines.ts';

const SENTENCE =
  'These are reports people chose to file. They are not a sample and cannot be read as a rate.';

async function page(ui: () => ReactNode, seed: (c: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(client);
  const root = createRootRoute({ component: () => <Outlet /> });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: ui });
  const router = createRouter({
    routeTree: root.addChildren([home]),
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
}

describe('the line beside every number', () => {
  it('is the spec’s sentence, from one constant', () => {
    expect(NOT_A_SAMPLE).toBe(SENTENCE);
  });

  it('is shown by the component, with what the API sent or else the constant', () => {
    const { rerender } = render(<NotASample />);
    expect(screen.getByText(SENTENCE)).toBeInTheDocument();
    rerender(<NotASample line="Served by the API." />);
    expect(screen.getByText('Served by the API.')).toBeInTheDocument();
  });

  it('is beside the board’s numbers', async () => {
    await page(
      () => <NumbersPage />,
      (c) => {
        const stats: ResponseOf<typeof getBoardStats> = {
          published: true,
          as_of: '2026-10-20T00:00:00Z',
          note: 'Counts of reviewed first-hand accounts.',
          not_a_sample: SENTENCE,
          published_reports: { by_logbook: {} },
        };
        c.setQueryData(boardStatsQuery.queryKey, stats);
      },
    );
    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
  });

  it('is beside a map’s counts', () => {
    const map: PublishedMap = {
      published: true,
      slug: 'm',
      title: 'M',
      blurb: null,
      as_of: '2026-10-20T00:00:00Z',
      note: 'A dark area may mean more problems.',
      not_a_sample: SENTENCE,
      threshold: 3,
      unit: { one: 'published report', many: 'published reports' },
      planes: ['us'],
      views: ['volume'],
      outcome_question: null,
      filter_key: null,
      areas: {},
      suppressed: { areas: [], reports: 0 },
    };
    render(<HeatMapView map={map} outlines={JSON.parse(outlinesText) as Outlines} />);
    expect(screen.getByText(SENTENCE)).toBeInTheDocument();
  });

  it('is on the press page, whose documents carry numbers', async () => {
    await page(
      () => <PressPage />,
      (c) => {
        c.setQueryData(pressQuery.queryKey, {
          state: 'ready',
          version: '1.0.0',
          commit: null,
          built_at: null,
          files: [],
          not_a_sample: SENTENCE,
        });
      },
    );
    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
  });

  it('no page prints the sentence itself: it comes from the constant', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
      });
    const offenders = walk(join(__dirname, '../src')).filter((f) =>
      readFileSync(f, 'utf8').includes('are not a sample'),
    );
    expect(offenders).toEqual([]);
  });
});
