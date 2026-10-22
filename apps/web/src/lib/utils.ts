import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Tailwind-merge, told about this site's own utilities (styles.css). Without
 * this it reads a name it does not know by its prefix: `border-control` (a
 * width) as a border colour, `text-lede` (a size) as a text colour, and
 * `shadow-raised` as something other than a shadow. It then dropped the
 * button's outline beside `border-ink`, the lede's size beside
 * `text-ink-alt`, and kept a quiet button's shadow beside `shadow-none`.
 */
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [{ shadow: ['raised', 'pressed'] }],
      'border-w': [{ border: ['control'] }],
      'font-size': [{ text: ['title', 'section', 'lede'] }],
    },
  },
});

/** Join class names, letting a later Tailwind class override an earlier one. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
