/**
 * The two pages a list's emails link to: deleting what you sent, and agreeing
 * to receive a list's entries.
 *
 * SERVED BY THE SERVER AS PLAIN HTML, not by the website. The link has to work
 * from any mail program on any device, in front of the site password, with no
 * script: a form and a button. Under /api/ because that is the one prefix
 * every deployment's proxy already sends to the server.
 *
 * A GET NEVER CHANGES ANYTHING. Mail scanners and link previewers open every
 * link in an email; if opening one erased, a security product would delete
 * people's words for them. The GET shows a button; only the POST acts.
 *
 * The page's one stylesheet is inline and allowed by its hash, so the content
 * security policy stays as strict as the rest of the site's.
 */
import { createHash } from 'node:crypto';
import type { FastifyReply } from 'fastify';

const STYLE = `
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f6f5f1;color:#1d1d1b}
main{max-width:34rem;margin:0 auto;padding:3rem 1rem}
h1{font-size:1.6rem;line-height:1.2;margin:0 0 1rem}
p{margin:0 0 1rem}
button{font:inherit;font-weight:600;padding:.6rem 1.2rem;border-radius:.4rem;border:1px solid #1d1d1b;background:#f2c94c;color:#1d1d1b;cursor:pointer}
button:focus-visible{outline:3px solid #1d1d1b;outline-offset:2px}
@media (prefers-color-scheme:dark){body{background:#1d1d1b;color:#f6f5f1}button{border-color:#f6f5f1}}
`;
const STYLE_HASH = createHash('sha256').update(STYLE, 'utf8').digest('base64');

/** Nothing loads, nothing runs, the form posts only back here, nothing frames it. */
const CSP = [
  "default-src 'none'",
  `style-src 'sha256-${STYLE_HASH}'`,
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

export const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head><body><main>
<h1>${esc(title)}</h1>
${body}
</main></body></html>`;
}

/** Send a page with the headers every one of these needs. */
export function sendPage(reply: FastifyReply, status: number, html: string): FastifyReply {
  return (
    reply
      .status(status)
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-security-policy', CSP)
      // A token in the address must not leave in a Referer, or sit in a cache.
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .send(html)
  );
}

export const brokenLink = () =>
  page('This link does not work', '<p>Check that the whole link was copied from the email.</p>');

export function erasePrompt(token: string): string {
  return page(
    'Delete what you wrote',
    `<p>This deletes what you wrote and your email address from what you sent. Any links you sent stay, because they point at things that are already public.</p>
<p>It cannot be undone.</p>
<form method="post" action="/api/forget/${esc(token)}">
<button type="submit">Delete it</button>
</form>`,
  );
}

export const eraseDone = () =>
  page('Deleted', '<p>What you wrote and your email address are gone. Nothing else is needed.</p>');

// Used, expired and unknown all read the same, on purpose: somebody probing
// tokens learns nothing from which it was.
export const eraseFinished = () =>
  page(
    'This link is finished',
    '<p>Either it was used already, in which case what you wrote is gone, or what it would have deleted has been deleted on its own schedule.</p>',
  );

export function mailPrompt(token: string): string {
  return page(
    'Receive new entries by email',
    `<p>Each new entry on this form will be emailed to you, including what people wrote and their email address if they gave one.</p>
<p>An administrator of the site can take you off at any time.</p>
<form method="post" action="/api/list-mail/${esc(token)}">
<button type="submit">Yes, send them to me</button>
</form>`,
  );
}

export const mailDone = (title: string, email: string) =>
  page('Done', `<p>New entries on <b>${esc(title)}</b> will be emailed to ${esc(email)}.</p>`);

export const mailFinished = () =>
  page(
    'This link is finished',
    '<p>It was used already, it is more than a week old, or somebody has since named a different address.</p>',
  );
