/**
 * Normalizing a submitted link: what is refused, and the form it is matched in.
 *
 * ACCEPT BROADLY, SORT AFTERWARDS. No domain allowlist at the door: an
 * allowlist blocks junk domains but not junk tips, and rejects the material
 * most worth having (a local news segment, a county clerk's statement). What
 * is rejected is only what cannot be a link to public material at all.
 *
 * THE SERVER NEVER REQUESTS A SUBMITTED URL. Not for a preview, not for a
 * thumbnail, not to check that it resolves. Nothing here performs I/O, and a
 * unit test says so: fetching would turn the form into a way to make this
 * server visit arbitrary addresses, and would tell whoever posted the material
 * that somebody looked.
 *
 * THIS IS ALSO THE MATCHING FORM (Plan D K11, settled in docs/plan-d.md
 * and docs/status/PD3-links.md). The links module keys its HMAC on what this returns: lower-case
 * scheme and host, default port and trailing slash removed, the query KEPT
 * but with trackers stripped and sorted, and a fragment kept only when it
 * points at something. The plan's "query and fragment kept" is met in that
 * sense; stripping `fbclid` also stops a tip carrying who shared it. No chain
 * reads it. CHANGING THE NORMALIZATION SPLITS EVERY GROUP AND STOPS EVERY
 * EXACT BLOCKLIST ENTRY MATCHING, so it is a decision, not a tidy-up.
 */

export const MAX_URL_LENGTH = 2048;

/**
 * NAMED, NEVER DISCOVERED. A pattern would quietly acquire whatever matched it
 * next, and a false positive here refuses somebody's tip.
 *
 * `youtu.be` IS DELIBERATELY ABSENT and must stay absent. It looks exactly like
 * a shortener and is YouTube's own canonical short form, so a naive list
 * rejects the clip of a local news segment: the material most worth having.
 */
export const SHORTENERS: ReadonlySet<string> = new Set([
  'bit.ly',
  'bitly.com',
  'j.mp',
  't.co',
  'tinyurl.com',
  'goo.gl',
  'ow.ly',
  'buff.ly',
  'is.gd',
  'v.gd',
  'rb.gy',
  'cutt.ly',
  'shorturl.at',
  'rebrand.ly',
  'bl.ink',
  't.ly',
  'lnkd.in',
  'fb.me',
  'amzn.to',
  'dlvr.it',
  'trib.al',
  'wp.me',
  'shor.by',
  'tiny.cc',
  'soo.gd',
  // Link monetizers, which interpose a page of their own.
  'adf.ly',
  'sh.st',
  'shorte.st',
]);

/**
 * Tracking parameters, stripped so forty people arriving from forty places
 * still dedup to one link. NOT HERE ON PURPOSE: `v` (YouTube's video id, the
 * content itself) and `t` (a timestamp on some hosts, so stripping it would
 * silently change which moment of a clip somebody meant).
 */
export const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'yclid',
  'twclid',
  'igshid',
  'igsh',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  'ref_src',
  'ref_url',
  'refsrc',
  's',
  'si',
  'cmpid',
  'ocid',
  'ncid',
  'cid',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  'vero_id',
  'oly_enc_id',
  'oly_anon_id',
  'spm',
  'scm',
  'trk',
  'trkcampaign',
  'wt_mc',
  'wtrid',
  'ito',
  'icid',
  'at_medium',
  'at_campaign',
]);
export const TRACKING_PREFIXES: readonly string[] = ['utm_'];

/**
 * A fragment is dropped unless it carries a post identifier. `#top` is page
 * furniture; `#comment-4821` is a different thing to point at; `#:~:text=` is
 * a browser's scroll-to-text directive, which is furniture that happens to be
 * long.
 */
const IDENTIFIER_FRAGMENT =
  /^(?:!|(?:post|comment|c|p|story|msg|message|entry|item|status|thread|reply|note)[-_/:]?\d+)/i;

export function fragmentCarriesIdentifier(fragment: string): boolean {
  const f = fragment.replace(/^#/, '');
  if (!f || f.startsWith(':~:')) return false;
  return IDENTIFIER_FRAGMENT.test(f);
}

/**
 * A host that is an address rather than a name, in every spelling it has:
 * the dotted quad, bracketed IPv6, and the integer and hexadecimal forms
 * (`http://2130706433/` and `http://0x7f000001/` both reach 127.0.0.1 and
 * neither contains a dot).
 */
export function hostIsBareAddress(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname.startsWith('[') || hostname.includes(':')) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  if (/^\d+$/.test(hostname)) return true;
  if (/^0x[0-9a-f]+$/i.test(hostname)) return true;
  if (/^0\d+(?:\.\d+)*$/.test(hostname)) return true;
  return false;
}

export const REJECTIONS = {
  EMPTY: 'empty',
  TOO_LONG: 'too-long',
  UNPARSEABLE: 'unparseable',
  SCHEME: 'not-http',
  CREDENTIALS: 'credentials-in-url',
  BARE_ADDRESS: 'bare-address-host',
  SHORTENER: 'shortener',
  NO_HOST: 'no-host',
} as const;

export type UrlRejection = (typeof REJECTIONS)[keyof typeof REJECTIONS];

export type NormalizedUrl =
  { ok: true; url: string; host: string } | { ok: false; reason: UrlRejection };

/** Never throws on bad input: every caller is handling something a stranger typed. */
export function normalizeUrl(input: unknown): NormalizedUrl {
  if (input === null || input === undefined) return { ok: false, reason: REJECTIONS.EMPTY };
  const raw = (typeof input === 'string' ? input : JSON.stringify(input)).trim();
  if (!raw) return { ok: false, reason: REJECTIONS.EMPTY };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: REJECTIONS.TOO_LONG };

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: REJECTIONS.UNPARSEABLE };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: REJECTIONS.SCHEME };
  }
  // A link carrying a password is not a link to public material.
  if (u.username || u.password) return { ok: false, reason: REJECTIONS.CREDENTIALS };

  // URL has already lowercased the host and punycoded an international one.
  // The trailing dot it keeps.
  const host = u.hostname.replace(/\.+$/, '');
  if (!host) return { ok: false, reason: REJECTIONS.NO_HOST };
  if (hostIsBareAddress(host)) return { ok: false, reason: REJECTIONS.BARE_ADDRESS };
  if (SHORTENERS.has(host)) return { ok: false, reason: REJECTIONS.SHORTENER };
  u.hostname = host;

  // Strip the trackers, then SORT what is left, so two apps' copies of one
  // link produce one key.
  const keep: [string, string][] = [];
  for (const [k, v] of u.searchParams) {
    const lower = k.toLowerCase();
    if (TRACKING_PARAMS.has(lower)) continue;
    if (TRACKING_PREFIXES.some((p) => lower.startsWith(p))) continue;
    keep.push([k, v]);
  }
  keep.sort((a, b) => (a[0] === b[0] ? cmp(a[1], b[1]) : cmp(a[0], b[0])));
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);

  if (!fragmentCarriesIdentifier(u.hash)) u.hash = '';
  // `/clip/` and `/clip` are one link. The root keeps its slash: URL always
  // writes one there.
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '') || '/';

  // URL has already dropped a default port (`:443` on https, `:80` on http).
  return { ok: true, url: u.toString(), host };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
