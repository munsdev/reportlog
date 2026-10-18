import { FEEDBACK_STATUS_LABELS } from './feedbackTaxonomy.js';
import { SITE_ORIGIN } from './siteOrigin.js';

const SITE = `${SITE_ORIGIN}/`;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

function contextLines(context) {
  const c = context || {};
  const bits = [
    c.tab ? `tab: ${c.tab}` : null,
    c.path ? `path: ${c.path}` : null,
    c.viewport ? `viewport: ${c.viewport}` : null,
    c.release ? `release: ${c.release}` : null,
    c.appVersion ? `build: ${c.appVersion}` : null,
    c.userAgent ? `browser: ${c.userAgent}` : null,
  ].filter(Boolean);
  return bits.length
    ? `<p style="font-family:monospace;font-size:12px;color:#666">${bits.map(esc).join('<br>')}</p>`
    : '';
}

// To the admin, on every new issue. Without an external tracker sending
// notifications there is no other push signal that something was filed —
// this email is the thing standing between a report and being forgotten.
export function newFeedbackHtml(fb) {
  return `
    <p><b>#${fb.id}</b> — new ${esc(fb.type)} (${esc(fb.severity)}) from ${esc(fb.submitter_email)}</p>
    <h2 style="font-size:17px;margin:14px 0 6px">${esc(fb.title)}</h2>
    <p style="white-space:pre-wrap">${esc(fb.body)}</p>
    ${fb.related_public_ref ? `<p>Related report: <b>${esc(fb.related_public_ref)}</b></p>` : ''}
    ${contextLines(fb.context)}
    <p><a href="${SITE}">Open the app</a> and go to the Issues tab to triage it.</p>
  `;
}

// To the reporter, when the admin moves their issue. The note is written
// for them and shown on their issue too — it is not a private audit
// comment, unlike self_service_log's reasons on reports.
export function feedbackStatusHtml(fb, status, note) {
  return `
    <p>Your ${esc(fb.type)} <b>#${fb.id}</b> is now <b>${esc(FEEDBACK_STATUS_LABELS[status] || status)}</b>.</p>
    <h2 style="font-size:17px;margin:14px 0 6px">${esc(fb.title)}</h2>
    ${note ? `<p style="white-space:pre-wrap">${esc(note)}</p>` : ''}
    <p><a href="${SITE}">Open the app</a> to see the full history on this issue.</p>
  `;
}

// Weekly, to the admin. Oldest first and loudest about what's been sitting
// untouched — the whole point is that nothing quietly rots at the bottom.
export function staleDigestHtml(items, staleDays) {
  const row = (f) => {
    const stale = f.days_untouched >= staleDays;
    return `
      <li style="margin-bottom:12px">
        ${stale ? '<b style="color:#8B1E2F">STALE</b> · ' : ''}
        <b>#${f.id}</b> ${esc(FEEDBACK_STATUS_LABELS[f.status] || f.status)} ·
        ${esc(f.type)} · ${esc(f.severity)}<br>
        ${esc(f.title)}<br>
        <small style="color:#666">from ${esc(f.submitter_email)} ·
        ${f.days_untouched} day(s) since last status change</small>
      </li>
    `;
  };
  return `
    <p>${items.length} open issue(s) in the feedback tracker, oldest first.</p>
    <ul style="list-style:none;padding:0">${items.map(row).join('')}</ul>
    <p><a href="${SITE}">Open the app</a> and go to the Issues tab.</p>
  `;
}
