// Public aggregate statistics.
//
// Two design rules, both deliberate:
//
// 1. NO BARE TOTAL. Every count arrives already broken out — by
//    disposition, logbook, and within a logbook by the questions
//    its maker marked as filters. A number
//    quoted from this endpoint carries its own qualification, because
//    there is no unqualified number available to quote. A live counter of
//    "election incidents" stripped of context is a misinformation vector,
//    and the structural fix is to not publish one.
//
// 2. THE DENOMINATOR IS VISIBLE. Counts of declined, still-under-review
//    and withdrawn reports are published alongside the approved ones, with
//    no content and no identity. Every confirmed report already occupies a
//    chain slot regardless of outcome, so this exposes what the chain
//    already records. It converts "trust our moderation" into "audit our
//    moderation": anyone can compute the approval rate over time.
//
// Never-confirmed submissions are absent by design — they never entered
// the chain, precisely so nobody can burn chain slots in someone else's
// name. That asymmetry is stated here rather than left silent.
import { pool } from './db.js';
import { VERACITY_FROZEN_KEYS } from './taxonomy.js';
import { launchedLogbooks, filterableFields } from './logbooks.js';
import { answerText } from './answerText.js';

// The third gate, beside the other two. A report whose reporter did not
// permit publication is never published, however a moderator judged it.
//
// Note what deliberately does NOT change: the denominator. The published
// figure counts reports that were declined, are under review, or were
// withdrawn, and a report with may_publish false still contributes a
// fingerprint, a position in the chain and a number to that public figure.
// That is intended, and the card's wording promises no more than it.
const PUBLISHED = "h.withdrawn = false AND h.moderation_status = 'valid' AND r.may_publish = true";

function disposition(row) {
  if (row.withdrawn) return 'withdrawn';
  // Checked before 'valid': a moderator approving a report the reporter did
  // not permit publishing does not make it published. Consent is the
  // ceiling, moderation is the floor.
  if (row.moderation_status === 'valid' && row.may_publish !== true) return 'not_permitted';
  if (row.moderation_status === 'valid') return 'published';
  if (row.moderation_status === 'invalid') return 'declined';
  if (row.moderation_status === 'unknown') return 'unclear';
  return 'under_review';
}

/**
 * The published aggregate, computed once here and served in two places:
 * /api/stats for the site's own board, and /api/v1/stats for anybody
 * outside. One implementation, so the public figure and the one on our own
 * page can never disagree — which would be the single most damaging kind
 * of bug this endpoint could have.
 */
export async function computeStats() {

  const { rows } = await pool.query(
    `SELECT h.moderation_status, h.withdrawn, h.veracity, h.incident_id,
            r.logbook_id, r.answers, h.assessed_severity AS severity, r.may_publish
     FROM report_heads h JOIN reports r ON r.id = h.current_report_id`,
  );

  const tally = (pairs) => pairs.reduce((acc, k) => (acc[k] = (acc[k] || 0) + 1, acc), {});

  const dispositions = tally(rows.map(disposition));
  const published = rows.filter(
    (r) => !r.withdrawn && r.moderation_status === 'valid' && r.may_publish === true,
  );

  // Corroboration is counted over published reports only, so the figure
  // matches what a reader can actually see corroborating an account.
  const incidentSizes = new Map();
  published.forEach((r) => {
    if (!r.incident_id) return;
    incidentSizes.set(r.incident_id, (incidentSizes.get(r.incident_id) || 0) + 1);
  });
  const corroborated = published.filter(
    (r) => r.incident_id && incidentSizes.get(r.incident_id) > 1,
  ).length;

  return {
    as_of: new Date().toISOString(),
    note: 'Counts of reviewed first-hand accounts, not verified facts. Published means a moderator judged a report publishable, which is a weaker claim than true. This archive does not publish a verdict on whether an account is true; where one is owed, the moderator who published it writes a note instead.',
    confirmed_reports: {
      by_disposition: {
        published: dispositions.published || 0,
        // A report a moderator approved and its reporter did not permit
        // publishing. It is counted here rather than dropped: the
        // denominator has always included reports that were declined,
        // withdrawn or still under review, and a report whose reporter said
        // no still contributes a fingerprint and a position in the chain.
        // Leaving it out would make the published figure look like a larger
        // share of the whole than it is, which is the one direction this
        // number must never be wrong in.
        not_permitted: dispositions.not_permitted || 0,
        under_review: dispositions.under_review || 0,
        declined: dispositions.declined || 0,
        unclear: dispositions.unclear || 0,
        withdrawn: dispositions.withdrawn || 0,
      },
      excludes: 'Submissions never confirmed by email are not counted: they never entered the record.',
    },
    published_reports: {
      // FROZEN, AND KEPT ONLY BECAUSE IT WAS PROMISED. The veracity verdict
      // is withdrawn (src/taxonomy.js says why), so nothing assesses one and
      // every published report sits at `pending`. That is not a placeholder:
      // it is the true count, and public/api.html says so in those words.
      //
      // It stays because `/api/v1` promises that an existing field is not
      // renamed, retyped or removed without a `/api/v2`. Breaking that
      // quietly would cost more than the field does — somebody's dashboard
      // would stop and there is no way to tell them. It goes at v2.
      //
      // Still computed from the column rather than hardcoded to zeros, so
      // that an archive carrying verdicts recorded BEFORE the withdrawal
      // keeps reporting them honestly instead of having its own history
      // rewritten by a deploy.
      by_veracity: Object.fromEntries(
        VERACITY_FROZEN_KEYS.map((k) => [k, published.filter((r) => r.veracity === k).length]),
      ),
      by_severity: tally(published.map((r) => r.severity)),
      by_logbook: await byLogbook(published),
      corroboration: {
        corroborated_accounts: corroborated,
        single_accounts: published.length - corroborated,
        distinct_incidents_with_multiple_accounts:
          [...incidentSizes.values()].filter((n) => n > 1).length,
      },
    },
  };
}

/**
 * Per logbook: how many of its reports are published, and — for each
 * question its maker marked as a filter — how many published reports gave
 * each answer. NOTHING IS BROKEN OUT UNLESS AN OPERATOR SAID SO, the same
 * rule as the board's filters: a question nobody marked is not counted here
 * either. A multiple-choice answer counts once under each choice ticked, so
 * those add up to more than the report total, which is the honest reading of
 * "how many reports mention this".
 */
async function byLogbook(published) {
  const out = {};
  for (const lb of await launchedLogbooks()) {
    const mine = published.filter((r) => Number(r.logbook_id) === Number(lb.id));
    const questions = {};
    for (const f of await filterableFields(lb.id)) {
      const counts = {};
      for (const r of mine) {
        const v = r.answers ? r.answers[f.key] : undefined;
        if (v === undefined) continue;
        for (const one of Array.isArray(v) ? v : [v]) {
          const k = answerText(one);
          counts[k] = (counts[k] || 0) + 1;
        }
      }
      questions[f.key] = { label: f.label, counts, unanswered: mine.filter((r) => !r.answers || r.answers[f.key] === undefined).length };
    }
    out[lb.slug] = { title: lb.title, published: mine.length, by_question: questions };
  }
  return out;
}

// One query serves every caller for a minute. The computation walks every
// report head, so without this a widget on somebody's home page polling
// every few seconds would be a full scan each time. A minute is well under
// how often these numbers meaningfully change.
const TTL_MS = 60 * 1000;
let cached = null;

export async function getStats() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = await computeStats();
  cached = { at: Date.now(), value };
  return value;
}

export function clearStatsCache() { cached = null; }
