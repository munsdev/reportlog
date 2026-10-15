/**
 * Normalizing a submitted link, and hashing it into `url_key`.
 *
 * ACCEPT BROADLY, SORT AFTERWARDS. There is no domain allowlist at the
 * door, deliberately: an allowlist blocks junk domains but not junk tips,
 * and it rejects the material most worth having — local news segments,
 * county clerk statements, direct file links. What is rejected is only what
 * cannot be a link to public material at all.
 *
 * THE SERVER NEVER REQUESTS A SUBMITTED URL. Not for a preview, not for a
 * thumbnail, not to check that it resolves. Nothing in this file performs
 * I/O, and that is the point rather than an implementation detail: fetching
 * would turn the form into a way to make this server visit arbitrary
 * addresses, and it would signal to whoever posted the material that
 * somebody looked.
 *
 * Nothing here is hashed into a report. `url_key` is a dedup key, not a
 * fingerprint, and no chain reads it.
 */
import { sha256Hex } from '../crypto.js';

export const MAX_URL_LENGTH = 2048;

/**
 * NAMED, NEVER DISCOVERED — the same discipline as `SWEPT` in src/sweep.js.
 * A pattern like /^(bit|t)\./ would quietly acquire whatever matched it
 * next, and the cost of a false positive here is refusing somebody's tip.
 *
 * `youtu.be` IS DELIBERATELY ABSENT and must stay absent. It looks exactly
 * like a shortener and it is YouTube's own canonical short form, so a naive
 * list rejects the clip of a local news segment — which is the single
 * category of material section 9 of the spec says is most worth having.
 * The same reasoning covers any host where the short domain IS the
 * publisher.
 */
export const SHORTENERS = new Set([
  'bit.ly', 'bitly.com', 'j.mp',
  't.co',
  'tinyurl.com',
  'goo.gl',
  'ow.ly',
  'buff.ly',
  'is.gd', 'v.gd',
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
  'adf.ly', 'sh.st', 'shorte.st',
]);

/**
 * Tracking parameters, stripped so that forty people arriving from forty
 * different places still dedup to one link.
 *
 * The `utm_` family is a documented prefix and is handled as one. Everything
 * else is named. Two that are NOT here on purpose: `v` (YouTube's video
 * identifier — it IS the content) and `t` (a timestamp on YouTube and a
 * share tracker on others, so stripping it would silently change which
 * moment of a clip somebody meant to point at).
 */
export const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid',
  'msclkid', 'yclid', 'twclid', 'igshid', 'igsh',
  'mc_cid', 'mc_eid', 'mkt_tok',
  'ref_src', 'ref_url', 'refsrc',
  's', 'si',
  'cmpid', 'ocid', 'ncid', 'cid',
  '_ga', '_gl', '_hsenc', '_hsmi',
  'vero_id', 'oly_enc_id', 'oly_anon_id',
  'spm', 'scm',
  'trk', 'trkcampaign',
  'wt_mc', 'wtrid',
  'ito', 'icid', 'at_medium', 'at_campaign',
]);
export const TRACKING_PREFIXES = ['utm_'];

/**
 * A fragment is dropped unless it carries a post identifier.
 *
 * `#top` and `#main-content` are page furniture and two links that differ
 * only in them are the same link. `#comment-4821` is a different thing to
 * point at. `#:~:text=` is a browser scroll-to-text directive, which is
 * page furniture that happens to be long.
 *
 * Named prefixes again, and a hashbang path, which was how a generation of
 * sites expressed a whole route.
 */
const IDENTIFIER_FRAGMENT =
  /^(?:!|(?:post|comment|c|p|story|msg|message|entry|item|status|thread|reply|note)[-_/:]?\d+)/i;

export function fragmentCarriesIdentifier(fragment) {
  if (!fragment) return false;
  const f = fragment.replace(/^#/, '');
  if (!f) return false;
  if (f.startsWith(':~:')) return false;
  return IDENTIFIER_FRAGMENT.test(f);
}

/**
 * A host that is an address rather than a name.
 *
 * Covers the dotted quad, the bracketed IPv6 form `URL` hands back, and the
 * integer and hexadecimal spellings of an IPv4 address — `http://2130706433/`
 * and `http://0x7f000001/` both reach 127.0.0.1 and neither contains a dot.
 * A checker that only knew the dotted quad would pass both.
 */
export function hostIsBareAddress(hostname) {
  if (!hostname) return false;
  if (hostname.startsWith('[') || hostname.includes(':')) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  if (/^\d+$/.test(hostname)) return true;
  if (/^0x[0-9a-f]+$/i.test(hostname)) return true;
  // Octal-ish dotted forms, e.g. 0177.0.0.1
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
};

/**
 * Normalize. Returns `{ ok: true, url, host, urlKey }` or
 * `{ ok: false, reason }` — never throws on bad input, because every caller
 * is handling something a stranger typed.
 */
export function normalizeUrl(input) {
  if (input === null || input === undefined) return { ok: false, reason: REJECTIONS.EMPTY };
  const raw = String(input).trim();
  if (!raw) return { ok: false, reason: REJECTIONS.EMPTY };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: REJECTIONS.TOO_LONG };

  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: REJECTIONS.UNPARSEABLE };
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: REJECTIONS.SCHEME };
  }
  // Credentials in front of the host. Checked before anything else about
  // the host, because the point of the form is to collect a link to public
  // material and a link carrying a password is not that.
  if (u.username || u.password) return { ok: false, reason: REJECTIONS.CREDENTIALS };

  // `URL` has already lowercased the host and converted an
  // internationalized one to punycode. The trailing dot it keeps.
  let host = u.hostname.replace(/\.+$/, '');
  if (!host) return { ok: false, reason: REJECTIONS.NO_HOST };
  if (hostIsBareAddress(host)) return { ok: false, reason: REJECTIONS.BARE_ADDRESS };
  if (SHORTENERS.has(host)) return { ok: false, reason: REJECTIONS.SHORTENER };

  u.hostname = host;
  // `URL` drops a default port on its own; an explicit one that matches is
  // already gone by here.
  u.username = '';
  u.password = '';

  // Strip the trackers, then SORT what is left. Sorting means `?a=1&b=2`
  // and `?b=2&a=1` dedup together, which is what somebody copying a link
  // out of two different apps produces.
  const keep = [];
  for (const [k, v] of u.searchParams) {
    const lower = k.toLowerCase();
    if (TRACKING_PARAMS.has(lower)) continue;
    if (TRACKING_PREFIXES.some((p) => lower.startsWith(p))) continue;
    keep.push([k, v]);
  }
  keep.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)
    : a[0] < b[0] ? -1 : 1));
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);

  if (!fragmentCarriesIdentifier(u.hash)) u.hash = '';

  return { ok: true, url: u.toString(), host, urlKey: urlKey(u.toString()) };
}

/**
 * The dedup key. sha256 of the NORMALIZED form, so the key is only as
 * stable as the normalization above — which is why changing that list is a
 * decision about every row already written, not a tidy-up.
 */
export function urlKey(normalizedUrl) {
  return sha256Hex(normalizedUrl);
}
