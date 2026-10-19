/**
 * The map's colours, and which step of them an area wears.
 *
 * A FOURTH MEANING-SET, after the action colour, "confirmed" and "serious",
 * and THE SAME IN EVERY PALETTE. A scale that varied with the operator's
 * palette would make two deployments' maps incomparable. None of the site's
 * status colours is used: an area wearing one would be saying something the
 * map does not mean. Ported from legacy public/tokens.css.
 *
 * VOLUME is sequential and monotonic in lightness, so it reads in greyscale
 * and under every form of colour blindness.
 *
 * OUTCOME is diverging AND monotonic in lightness, which is the part not to
 * undo. A symmetric diverging ramp is dark at both ends, so when hue
 * collapses the ends collapse onto each other: simulated, green-to-red
 * INVERTS for a deuteranope. Lightness carries the axis for everyone. The
 * cost is that the middle step does not look neutral, so the legend says
 * "evenly split" in words.
 */
import type { AreaCount, MapView } from '@reportlog/contracts';

export const STEPS = 5;

export const SCALES: Record<MapView, readonly string[]> = {
  volume: ['#E6E9F4', '#C0C7E3', '#8D97C8', '#5A64A2', '#333B6B'],
  // Step 1 is most positive.
  outcome: ['#E2F0D2', '#A5D086', '#C6BCC0', '#AC5F8A', '#5F0E40'],
};

/** An area with nothing counted. Not a step: it has not earned a colour. */
export const NO_DATA = '#DCE3E7';
/** An area under the threshold: counted, and its number withheld. */
export const BELOW = '#B4BEC5';

/** The legend's words at each end of the ramp, and in the middle. */
export const ENDS: Record<MapView, [string, string, string]> = {
  volume: ['fewest', '', 'most'],
  outcome: ['mostly positive', 'evenly split', 'mostly negative'],
};

/**
 * The number an area is coloured by. For the outcome, the share of the
 * ASSESSED reports that leaned negative minus positive, in −1…1, or null when
 * nothing was assessed: null is "no answers", not "evenly split".
 */
export function valueOf(view: MapView, a: AreaCount): number | null {
  if (view === 'volume') return a.n;
  return a.assessed ? (a.neg - a.pos) / a.assessed : null;
}

/**
 * A step from 1 to STEPS, or 0 for unshaded.
 *
 * ONE SCALE OVER EVERYTHING ON A PLANE. Outcome is anchored at zero and
 * symmetric about it, never quantiled: a quantile moves the neutral point
 * with the data, and two readings of one map stop being comparable. Volume is
 * square-rooted, so one very large area does not push every other into the
 * lightest step.
 */
export function binner(view: MapView, shown: readonly AreaCount[]): (a: AreaCount) => number {
  if (view === 'outcome') {
    return (a) => {
      const v = valueOf('outcome', a);
      if (v === null) return 0;
      return v <= -0.5 ? 1 : v < -0.12 ? 2 : v <= 0.12 ? 3 : v < 0.5 ? 4 : 5;
    };
  }
  const roots = shown.map((a) => Math.sqrt(a.n)).sort((x, y) => x - y);
  const lo = roots[0];
  const hi = roots[roots.length - 1];
  return (a) => {
    if (lo === undefined || hi === undefined) return 1;
    if (hi === lo) return STEPS;
    const t = (Math.sqrt(a.n) - lo) / (hi - lo);
    return Math.min(STEPS, Math.max(1, Math.ceil(t * STEPS)));
  };
}

export function colourOf(view: MapView, step: number): string {
  return step > 0 ? (SCALES[view][step - 1] ?? NO_DATA) : NO_DATA;
}
