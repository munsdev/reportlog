/**
 * The map on the page. Two maps at once, because that is the case that broke
 * legacy: every part found by id meant the second map painted the first.
 */
import type { PublishedMap } from '@reportlog/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HeatMapView } from '../../src/features/maps/HeatMap.tsx';
import outlinesText from '../../src/features/maps/outlines.json?raw';
import type { Outlines } from '../../src/features/maps/outlines.ts';
import { pathOf } from '../../src/features/maps/outlines.ts';
import { BELOW, NO_DATA, SCALES, binner, colourOf } from '../../src/features/maps/scale.ts';

// Through Vite, so the test reads the file the site serves, in any test environment.
const outlines = JSON.parse(outlinesText) as Outlines;

const area = (
  n: number,
  extra: Partial<{ assessed: number; pos: number; neg: number; neu: number }> = {},
) => ({
  n,
  assessed: 0,
  pos: 0,
  neg: 0,
  neu: 0,
  ...extra,
});

function payload(over: Partial<PublishedMap> = {}): PublishedMap {
  return {
    published: true,
    slug: 'polling',
    title: 'Polling places',
    blurb: null,
    as_of: '2026-10-19T12:00:00.000Z',
    note: 'Not a survey.',
    threshold: 3,
    unit: { one: 'published report', many: 'published reports' },
    planes: ['us'],
    views: ['volume'],
    outcome_question: null,
    filter_key: 'where',
    areas: { 'US-AZ': area(4), 'US-CA': area(9), 'US-AK': area(3) },
    suppressed: { areas: ['US-NV', 'US-WY', 'US-GU'], reports: 4 },
    ...over,
  };
}

const roots = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-map-root]')];
const pathFor = (root: HTMLElement, code: string) => {
  const p = root.querySelector<SVGPathElement>(`svg[role="img"] path[data-code="${code}"]`);
  if (!p) throw new Error(`no path for ${code}`);
  return p;
};
const tap = (el: Element) => {
  fireEvent.pointerDown(el, { clientX: 5, clientY: 5 });
  fireEvent.pointerUp(el, { clientX: 5, clientY: 5 });
};

describe('a heat map', () => {
  it('shades counted areas, marks suppressed ones without a number, and leaves the rest empty', () => {
    const { container } = render(<HeatMapView map={payload()} outlines={outlines} />);
    const [root] = roots(container);
    if (!root) throw new Error('no map');
    expect(pathFor(root, 'US-CA').getAttribute('fill')).toBe(SCALES.volume[4]);
    expect(pathFor(root, 'US-NV').getAttribute('fill')).toBe(BELOW);
    expect(pathFor(root, 'US-TX').getAttribute('fill')).toBe(NO_DATA);
    expect(pathFor(root, 'US-NV').textContent).toBe('Nevada: fewer than 3, not shown');
    // A tile for a suppressed territory says "<3", never a number.
    const tiles = within(root).getByRole('list', { name: 'Alaska, Hawaii and the territories' });
    expect(
      within(tiles).getByRole('button', { name: 'Guam <3: fewer than 3, not shown' }),
    ).toHaveTextContent('<3');
    expect(
      within(tiles).getByRole('button', { name: 'Alaska 3: 3 published reports' }),
    ).toHaveTextContent('3');
  });

  it('names each tile by what it shows first, so speech input can press it (WCAG 2.5.3)', () => {
    const { container } = render(<HeatMapView map={payload()} outlines={outlines} />);
    const [root] = roots(container);
    if (!root) throw new Error('no map');
    const tiles = within(root).getByRole('list', { name: 'Alaska, Hawaii and the territories' });
    const buttons = within(tiles).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Alaska 3: 3 published reports',
      'Hawaii: none counted',
      'Puerto Rico: none counted',
      'US Virgin Is., US Virgin Islands: none counted',
      'Guam <3: fewer than 3, not shown',
      'N. Marianas, N. Mariana Islands: none counted',
      'Am. Samoa, American Samoa: none counted',
    ]);
    // What axe's label-content-name-mismatch asks, said directly: axe itself
    // cannot see text in jsdom, which has no layout, so it passes anything.
    for (const b of buttons) {
      const shown = [...b.querySelectorAll('span')]
        .map((x) => x.textContent)
        .filter((x) => x !== '—')
        .join(' ');
      expect(b.getAttribute('aria-label')?.startsWith(shown), shown).toBe(true);
    }
  });

  it('says what is behind a colour, and for a suppressed area says only that it is under the threshold', () => {
    const { container } = render(<HeatMapView map={payload()} outlines={outlines} />);
    const [root] = roots(container);
    if (!root) throw new Error('no map');
    tap(pathFor(root, 'US-AZ'));
    expect(within(root).getByRole('heading', { name: 'Arizona' })).toBeInTheDocument();
    expect(root).toHaveTextContent('4 published reports');
    tap(pathFor(root, 'US-WY'));
    expect(within(root).getByRole('heading', { name: 'Wyoming' })).toBeInTheDocument();
    expect(root).toHaveTextContent(/Fewer than 3 published reports, so this area is not shaded/);
  });

  it('lists every area in words, for the keyboard and a screen reader', async () => {
    const { container } = render(<HeatMapView map={payload()} outlines={outlines} />);
    const [root] = roots(container);
    if (!root) throw new Error('no map');
    await userEvent.click(within(root).getByText(/Every area as a list/));
    const table = within(root).getByRole('table');
    expect(within(table).getByRole('row', { name: 'California 9' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: 'Nevada fewer than 3' })).toBeInTheDocument();
  });

  it('calls an entry an entry', () => {
    render(
      <HeatMapView
        map={payload({ unit: { one: 'approved entry', many: 'approved entries' } })}
        outlines={outlines}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Alaska 3: 3 approved entries' }),
    ).toBeInTheDocument();
  });

  it('offers the operator’s planes and views and nothing else, and keeps a link from selecting a suppressed area', async () => {
    const { container } = render(
      <HeatMapView
        map={payload({
          planes: ['us', 'world'],
          areas: { 'US-AZ': area(4), DE: area(5) },
          suppressed: { areas: ['US-NV', 'FR'], reports: 3 },
        })}
        outlines={outlines}
        start={{ plane: 'world', area: 'FR' }}
      />,
    );
    const [root] = roots(container);
    if (!root) throw new Error('no map');
    expect(within(root).getByRole('button', { name: 'World' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(root).queryByRole('group', { name: 'What the colour shows' })).toBeNull();
    // `area=FR` named an area under the threshold, so nothing is selected.
    expect(within(root).queryByRole('heading', { name: 'France' })).toBeNull();
    expect(pathFor(root, 'DE').getAttribute('fill')).not.toBe(NO_DATA);
    // No tiles on the world plane, and US states are not on it.
    expect(within(root).queryByRole('list', { name: /territories/ })).toBeNull();
    expect(root.querySelector('path[data-code="US-AZ"]')).toBeNull();
    await userEvent.click(within(root).getByRole('button', { name: 'United States' }));
    expect(pathFor(root, 'US-AZ')).toBeTruthy();
  });
});

describe('two maps on one page', () => {
  it('keep to themselves: nothing has an id, and tapping one changes only that one', () => {
    const { container } = render(
      <>
        <HeatMapView map={payload()} outlines={outlines} />
        <HeatMapView
          map={payload({
            slug: 'workplaces',
            title: 'Workplaces',
            areas: { 'US-TX': area(7) },
            suppressed: { areas: [], reports: null },
          })}
          outlines={outlines}
        />
      </>,
    );
    const [first, second] = roots(container);
    if (!first || !second) throw new Error('two maps expected');
    // NOT ONE ELEMENT IN EITHER MAP CARRIES AN ID.
    expect(first.querySelectorAll('[id]')).toHaveLength(0);
    expect(second.querySelectorAll('[id]')).toHaveLength(0);

    tap(pathFor(second, 'US-TX'));
    expect(within(second).getByRole('heading', { name: 'Texas' })).toBeInTheDocument();
    expect(within(first).queryByRole('heading', { name: 'Texas' })).toBeNull();
    expect(pathFor(second, 'US-TX').getAttribute('data-selected')).toBe('true');
    expect(pathFor(first, 'US-TX').getAttribute('data-selected')).toBeNull();
    // Each is shaded by its own counts.
    expect(pathFor(first, 'US-TX').getAttribute('fill')).toBe(NO_DATA);
    expect(pathFor(second, 'US-TX').getAttribute('fill')).toBe(SCALES.volume[4]);
  });
});

describe('the scale', () => {
  it('square-roots volume over the shaded areas, and anchors the outcome at zero', () => {
    const shown = [area(1), area(4), area(100)];
    const step = binner('volume', shown);
    expect(step(area(1))).toBe(1);
    expect(step(area(100))).toBe(5);
    const out = binner('outcome', []);
    expect(out(area(4, { assessed: 4, pos: 4 }))).toBe(1);
    expect(out(area(4, { assessed: 4, pos: 2, neg: 2 }))).toBe(3);
    expect(out(area(4, { assessed: 4, neg: 4 }))).toBe(5);
    // Nothing assessed is unshaded, not "evenly split".
    expect(out(area(4))).toBe(0);
    expect(colourOf('outcome', 0)).toBe(NO_DATA);
  });

  it('draws an area’s rings as one path', () => {
    expect(
      pathOf([
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
        ],
      ]),
    ).toBe('M0,0L1,0L1,1Z');
  });
});
