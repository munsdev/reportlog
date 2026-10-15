import { SITE_ORIGIN } from './siteOrigin.js';
import { answerText } from './answerText.js';

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}[c]));

/**
 * One report in an email: its reference, which logbook it came through, and
 * each question it answered, in the logbook's order and in the words the
 * reporter read. `report.questions` is that logbook's field list; a key with
 * no question left to name it (there should be none — a launched logbook's
 * questions are never removed) is shown under its key rather than dropped.
 */
function reportLine(report) {
  const answers = report.answers || {};
  const questions = report.questions || [];
  const named = new Set();
  const lines = [];
  for (const q of questions) {
    if (answers[q.key] === undefined) continue;
    named.add(q.key);
    lines.push(`${esc(q.label)} <b>${esc(answerText(answers[q.key]))}</b>`);
  }
  for (const [k, v] of Object.entries(answers)) {
    if (!named.has(k)) lines.push(`${esc(k)}: <b>${esc(answerText(v))}</b>`);
  }
  return `
    <li style="margin-bottom:14px">
      <b>${esc(report.public_ref)}</b> — ${esc(report.logbook_title || report.logbook_slug || '')}<br>
      ${lines.join('<br>') || 'No answers recorded.'}
    </li>
  `;
}

/**
 * `siteName` is passed in rather than read here: this module is pure string
 * building and has no database of its own.
 */
export function singleReportHtml(report, siteName = 'ReportLog') {
  return `
    <p>New report on ${esc(siteName)}.</p>
    <ul style="list-style:none;padding:0">${reportLine(report)}</ul>
    <p><a href="${SITE_ORIGIN}/#dash">View on the board</a></p>
  `;
}

export function batchReportsHtml(reports, introText) {
  return `
    <p>${esc(introText)}</p>
    <ul style="list-style:none;padding:0">${reports.map(reportLine).join('')}</ul>
    <p><a href="${SITE_ORIGIN}/#dash">View on the board</a></p>
  `;
}
