/**
 * Naming a written account in a URL.
 *
 *   report-<report_values.id>       a report's text
 *   tip-<list_entries.id>-<key>     a tip's long-text answer
 *
 * A report's ref names the row of the NEWEST version when the screen drew it,
 * but a check belongs to the words (their sealed fingerprint), so a ref from
 * an older version of the same words still finds the same item.
 */
export type TextRef =
  { source: 'report'; valueId: number } | { source: 'tip'; entryId: number; fieldKey: string };

export function parseRef(raw: string): TextRef | null {
  const report = /^report-(\d{1,15})$/.exec(raw);
  if (report?.[1]) return { source: 'report', valueId: Number(report[1]) };
  const tip = /^tip-(\d{1,15})-([a-z0-9][a-z0-9_]{0,38})$/.exec(raw);
  if (tip?.[1] && tip[2]) return { source: 'tip', entryId: Number(tip[1]), fieldKey: tip[2] };
  return null;
}

export const refOf = (r: TextRef): string =>
  r.source === 'report' ? `report-${String(r.valueId)}` : `tip-${String(r.entryId)}-${r.fieldKey}`;
