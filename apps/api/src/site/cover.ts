import { Cover } from '@reportlog/contracts';

/**
 * A stored cover read back (decision 78). Anything that no longer fits the
 * shape reads as no cover, so a bad row can never break a form. Never sealed.
 */
export function coverOf(raw: unknown): Cover | null {
  if (raw === null || raw === undefined) return null;
  const parsed = Cover.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
