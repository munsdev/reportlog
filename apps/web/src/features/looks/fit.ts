/**
 * Headline fitting, the arithmetic. Ported from the mock-up's `fit()`
 * (docs/ui-mockup/src/site.js) with the DOM taken out, so the decisions can
 * be tested without a layout engine:
 *
 *   1. Every typed line stays on ONE line, at the largest size that fits
 *      between the theme's smallest and largest.
 *   2. If that comes out small (under 62% of the largest), try letting each
 *      line wrap once, at most two rows a line. If that is much larger
 *      (20% or more), wrap.
 *   3. If not even the smallest size fits on one line, wrap at the smallest.
 *
 * The component (components/ui/fit-headline.tsx) supplies the two
 * measurements; this decides.
 */

export interface FitRange {
  min: number;
  max: number;
}

export interface FitChoice {
  /** The font size to use, in whole px. */
  size: number;
  /** True when a line that cannot fit may break onto a second row. */
  wrap: boolean;
}

/** A single line this much under the largest size is worth trying to wrap instead. */
export const WRAP_BELOW = 0.62;
/** A wrapped headline must beat the one-line size by this factor to be used. */
export const WRAP_GAIN = 1.2;
/** A wrapped line may be this many line heights tall: two rows and a little leading. */
export const WRAP_ROWS = 2.2;
/** Easier reading never lets a headline grow past this. */
export const EASY_MAX = 64;

/**
 * The largest size from `min` to `max` at which `fits` holds, by halving.
 * Returns `max` if that fits, else the best size found, else 0 (nothing in
 * between fits: the caller decides what to do then).
 */
export function searchLargest(range: FitRange, fits: (size: number) => boolean, steps = 9): number {
  if (fits(range.max)) return range.max;
  let lo = range.min;
  let hi = range.max;
  let best = 0;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) {
      best = mid;
      lo = mid;
    } else hi = mid;
  }
  return best;
}

/**
 * The range a headline is fitted in: the theme's, no larger than the caller
 * asked for, and no larger than Easier reading allows. A range whose largest
 * is below its smallest collapses to the largest.
 */
export function effectiveRange(
  theme: FitRange,
  opts: { maxSize?: number | undefined; easy?: boolean | undefined } = {},
): FitRange {
  let max = theme.max;
  if (opts.maxSize !== undefined) max = Math.min(max, opts.maxSize);
  if (opts.easy) max = Math.min(max, EASY_MAX);
  return { min: Math.min(theme.min, max), max };
}

export function decideFit(
  range: FitRange,
  fits: { oneLine: (size: number) => boolean; wrapped: (size: number) => boolean },
): FitChoice {
  const single = searchLargest(range, fits.oneLine);
  let wrapped = 0;
  if (single < range.max * WRAP_BELOW) wrapped = searchLargest(range, fits.wrapped);
  if (wrapped > single * WRAP_GAIN) return { size: Math.floor(wrapped), wrap: true };
  if (single) return { size: Math.floor(single), wrap: false };
  return { size: range.min, wrap: true };
}
