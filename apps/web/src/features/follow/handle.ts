import type { SocialPlatform } from '@reportlog/contracts';

/**
 * The account's name as people say it ("@name"), read from the address that
 * was stored. Nothing is shipped in code: with no address there is no handle,
 * and a link that cannot be read gives none rather than a guess.
 */
export function socialHandle(platform: SocialPlatform, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const last = parsed.pathname.split('/').filter(Boolean).at(-1);
  if (!last) return null;
  const bare = decodeURIComponent(last).replace(/^@/, '');
  // A Mastodon handle names its server too.
  if (platform === 'mastodon') return `@${bare}@${parsed.hostname}`;
  return `@${bare}`;
}
