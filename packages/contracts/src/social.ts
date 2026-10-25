/**
 * The site's accounts elsewhere, and the floating "Follow us" button's
 * choices. Here and not in site.ts so the front page's buttons (logbooks.ts)
 * can name them without importing the site's schemas, which reach back to the
 * board and from there to the logbooks.
 */
import { z } from 'zod';

// ── the site's accounts elsewhere ───────────────────────────────────────

/**
 * The social media accounts a site may link to, in the order they are
 * drawn. Each is switched on or off on its own, and an address can be kept
 * while it is off. A platform added in a later release appears, off, on
 * every site (`resolveSocialLinks`).
 *
 * A LINK IS NOT A REQUEST. The icons are drawn from paths bundled with the
 * website (components/ui/social-icon.tsx), never fetched, and nothing is
 * embedded: no follow button, no feed, no counter. Each is a plain link,
 * sent without a referrer, so the platform is not told which page of this
 * site somebody left from.
 */
export const SOCIAL_PLATFORMS = [
  'facebook',
  'instagram',
  'threads',
  'bluesky',
  'tiktok',
  'youtube',
  'mastodon',
  'x',
  'telegram',
  'whatsapp',
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export const SocialPlatformSchema = z.enum(SOCIAL_PLATFORMS);

interface PlatformRule {
  name: string;
  /** The hosts an address may be on, each with or without subdomains. Empty: any host (Mastodon). */
  hosts: readonly string[];
  /** The address a bare handle stands for, or null where there is no such thing as a handle. */
  handle: ((h: string) => string) | null;
  /** What the address field suggests. */
  example: string;
}

export const SOCIAL_RULES: Record<SocialPlatform, PlatformRule> = {
  facebook: {
    name: 'Facebook',
    hosts: ['facebook.com', 'fb.com', 'fb.me'],
    handle: (h) => `https://www.facebook.com/${h}`,
    example: 'https://www.facebook.com/yourpage',
  },
  instagram: {
    name: 'Instagram',
    hosts: ['instagram.com'],
    handle: (h) => `https://www.instagram.com/${h}`,
    example: '@yourname',
  },
  threads: {
    name: 'Threads',
    hosts: ['threads.com', 'threads.net'],
    handle: (h) => `https://www.threads.com/@${h}`,
    example: '@yourname',
  },
  bluesky: {
    name: 'Bluesky',
    hosts: ['bsky.app'],
    handle: (h) => `https://bsky.app/profile/${h}`,
    example: '@yourname.bsky.social',
  },
  tiktok: {
    name: 'TikTok',
    hosts: ['tiktok.com'],
    handle: (h) => `https://www.tiktok.com/@${h}`,
    example: '@yourname',
  },
  youtube: {
    name: 'YouTube',
    hosts: ['youtube.com', 'youtu.be'],
    handle: (h) => `https://www.youtube.com/@${h}`,
    example: '@yourchannel',
  },
  mastodon: {
    name: 'Mastodon',
    hosts: [],
    // A Mastodon handle names its server too, so it is read separately.
    handle: null,
    example: '@yourname@mastodon.social',
  },
  x: {
    name: 'X',
    hosts: ['x.com', 'twitter.com'],
    handle: (h) => `https://x.com/${h}`,
    example: '@yourname',
  },
  telegram: {
    name: 'Telegram',
    hosts: ['t.me', 'telegram.me'],
    handle: (h) => `https://t.me/${h}`,
    example: '@yourchannel',
  },
  whatsapp: {
    name: 'WhatsApp',
    hosts: ['whatsapp.com', 'wa.me'],
    handle: null,
    example: 'https://whatsapp.com/channel/…',
  },
};

export const MAX_SOCIAL_ADDRESS = 300;

/** As stored and as the settings screen edits it: every platform, in order. */
export const SocialLink = z.object({
  id: SocialPlatformSchema,
  /** The address as checked, or null when none was given. */
  url: z.string().nullable(),
  shown: z.boolean(),
});
export type SocialLink = z.infer<typeof SocialLink>;

/** As every page reads it: only the accounts switched on, in order. */
export const PublicSocialLink = z.object({ id: SocialPlatformSchema, url: z.string() });
export type PublicSocialLink = z.infer<typeof PublicSocialLink>;

const HANDLE = /^[A-Za-z0-9._-]{1,100}$/;
const MASTODON_HANDLE = /^@?([A-Za-z0-9_]{1,60})@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/;

const onHost = (hostname: string, hosts: readonly string[]) =>
  hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));

/**
 * What an administrator typed, as the address it stands for: a link (with
 * or without `https://`), or a handle (`@name`) for the platforms that have
 * them. Null for nothing typed. Refused, in words, when it is on another
 * site than the platform's, is not https, or is not an address at all.
 * One function, used by the screen as it is typed and by the server on
 * write, so the two cannot disagree.
 */
export function socialAddress(
  platform: SocialPlatform,
  raw: string,
): { ok: true; url: string | null } | { ok: false; error: string } {
  const rule = SOCIAL_RULES[platform];
  const typed = raw.trim();
  if (!typed) return { ok: true, url: null };
  if (typed.length > MAX_SOCIAL_ADDRESS) {
    return { ok: false, error: `Keep the address under ${String(MAX_SOCIAL_ADDRESS)} characters.` };
  }
  let candidate: string;
  const mastodon = platform === 'mastodon' ? MASTODON_HANDLE.exec(typed) : null;
  if (mastodon) {
    candidate = `https://${String(mastodon[2])}/@${String(mastodon[1])}`;
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(typed)) {
    candidate = typed;
  } else if (
    rule.handle &&
    HANDLE.test(typed.replace(/^@/, '')) &&
    // "bsky.app/profile/x" without its https:// is an address, not a handle;
    // "name.bsky.social" is a handle.
    !onHost(typed.split('/')[0]?.toLowerCase() ?? '', rule.hosts)
  ) {
    candidate = rule.handle(typed.replace(/^@/, ''));
  } else {
    candidate = `https://${typed}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: `That is not an address. Try something like ${rule.example}.` };
  }
  // Upgraded rather than refused: every one of these platforms serves https.
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Give a web address, starting https://.' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Leave the user name and password out of the address.' };
  }
  const hostname = url.hostname.toLowerCase();
  if (rule.hosts.length ? !onHost(hostname, rule.hosts) : !hostname.includes('.')) {
    return {
      ok: false,
      error: rule.hosts.length
        ? `That address is not on ${rule.name}. It should be on ${rule.hosts[0] ?? ''}, like ${rule.example}.`
        : `That is not an address. Try something like ${rule.example}.`,
    };
  }
  if (url.pathname === '/' && !url.search) {
    return {
      ok: false,
      error: `Link to your own ${rule.name} account, not ${rule.name}’s front page.`,
    };
  }
  return { ok: true, url: url.href };
}

/**
 * The accounts as stored, made whole: every platform once, in the shipped
 * order, a platform the list does not name off and empty. An entry this
 * release cannot read is dropped, and one switched on with no address (or
 * one that is not https) is read as off. One function, used by the server on read and on write.
 */
export function resolveSocialLinks(stored: unknown): SocialLink[] {
  const found = new Map<SocialPlatform, SocialLink>();
  if (Array.isArray(stored)) {
    for (const raw of stored as unknown[]) {
      const parsed = SocialLink.safeParse(raw);
      if (parsed.success && !found.has(parsed.data.id)) found.set(parsed.data.id, parsed.data);
    }
  }
  return SOCIAL_PLATFORMS.map((id) => {
    const link = found.get(id);
    if (!link) return { id, url: null, shown: false };
    // Only `socialAddress` writes here, but this string becomes an href on
    // every page, so anything that is not https is read as no address.
    const url = link.url?.startsWith('https://') ? link.url : null;
    return { id, url, shown: link.shown && url !== null };
  });
}

/**
 * The floating "Follow us" button. `on` is the switch; `pages` are the public
 * pages that may carry it. THE LIST CAN NEVER NAME A FORM OR A DOOR: there is
 * no id for one, so no stored value can put it there. One card asks one
 * question, and nothing changes under a person filling a form.
 */
export const SOCIAL_FLOAT_PAGES = ['front', 'board', 'maps', 'about', 'journalists'] as const;
export type SocialFloatPage = (typeof SOCIAL_FLOAT_PAGES)[number];
export const SOCIAL_FLOAT_PAGE_NAMES: Record<SocialFloatPage, string> = {
  front: 'The front page',
  board: 'The board',
  maps: 'The maps',
  about: 'About',
  journalists: 'Journalists',
};
export const SocialFloat = z.object({
  on: z.boolean(),
  pages: z.array(z.enum(SOCIAL_FLOAT_PAGES)),
});
export type SocialFloat = z.infer<typeof SocialFloat>;

/**
 * The stored setting, made whole: off unless it says on, every page named at
 * most once in the shipped order, and every page when none was ever chosen
 * (so switching it on starts where most sites want it).
 */
export function resolveSocialFloat(stored: unknown): SocialFloat {
  const raw =
    typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const named = Array.isArray(raw.pages) ? (raw.pages as unknown[]) : null;
  return {
    on: raw.on === true,
    pages: named ? SOCIAL_FLOAT_PAGES.filter((p) => named.includes(p)) : [...SOCIAL_FLOAT_PAGES],
  };
}

/**
 * Which of those pages a path is, or null: a path that is none of them (a
 * filing form, a list form, a door, a staff screen) never carries the button.
 */
export function socialFloatPageOf(pathname: string): SocialFloatPage | null {
  const at = (root: string) => pathname === root || pathname.startsWith(`${root}/`);
  if (pathname === '/') return 'front';
  if (at('/board')) return 'board';
  if (at('/map')) return 'maps';
  if (at('/about')) return 'about';
  // The journalists' own page only: its sign-up and alert screens are forms.
  if (pathname === '/journalists') return 'journalists';
  return null;
}

/** The accounts a visitor sees: switched on and with an address. */
export function shownSocialLinks(links: readonly SocialLink[]): PublicSocialLink[] {
  return links.flatMap((l) => (l.shown && l.url ? [{ id: l.id, url: l.url }] : []));
}
