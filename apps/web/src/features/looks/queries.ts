/**
 * The installed look packs, for the Look screen: the upload panel's
 * "Installed" list, and the picker, which offers each pack's looks,
 * palettes and themes beside the built-in ones.
 */
import { listLookPacks } from '@reportlog/contracts';
import { queryOptions } from '@tanstack/react-query';
import { call } from '@/lib/api.ts';

export const lookPacksQuery = queryOptions({
  queryKey: ['look-packs'],
  queryFn: ({ signal }) => call(listLookPacks, { signal }),
});

/** A chosen file as base64, the way the check and install calls carry it. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('The file could not be read.'));
    };
    reader.readAsDataURL(file);
  });
}

/** "3 palettes, 1 theme and 2 looks", leaving out what there are none of. */
export function addsWhat(counts: { palettes: number; themes: number; looks: number }): string {
  const parts = (
    [
      [counts.palettes, 'palette'],
      [counts.themes, 'theme'],
      [counts.looks, 'look'],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${String(n)} ${word}${n === 1 ? '' : 's'}`);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}

/**
 * The check's sentences grouped by the palette or theme they name, in the
 * order they came; everything else is about the pack as a whole.
 */
export function groupProblems(problems: readonly string[]): { title: string; items: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const p of problems) {
    const m = /^(Palette|Theme) "([^"]+)"/.exec(p);
    const title = m ? `${m[1] ?? ''} "${m[2] ?? ''}"` : 'The pack';
    groups.set(title, [...(groups.get(title) ?? []), p]);
  }
  return [...groups].map(([title, items]) => ({ title, items }));
}
