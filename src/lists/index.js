/**
 * LISTS: the second format, beside logbooks.
 *
 * A FORM IS THE QUESTION SET. LOGBOOK OR LIST IS WHAT HAPPENS TO THE
 * ANSWERS. A logbook has a form; a list has a form. Same field types, same
 * card engine, same builder. The container is the whole decision, and it is
 * one question: does this need to be permanent and verifiable?
 *
 *   A LOGBOOK seals, chains, is append-only and permanent, asks the spine
 *   of every report, and publishes nothing until a moderator approves it
 *   one by one.
 *
 *   A LIST seals nothing, chains nothing, keeps an editable form, erases
 *   the personal half of its entries on a timer, is approved in bulk, and
 *   publishes counts rather than content.
 *
 * THE SEPARATION RULE, which is the point of the whole design:
 *
 *   NOTHING UNDER src/lists/ IMPORTS reportCore.js, AND NOTHING IN IT
 *   WRITES TO A CHAIN.
 *
 * If a file in this directory can reach the sealing code, it is the wrong
 * file. `npm test` asserts it by walking the import graph TRANSITIVELY,
 * because reach one hop away is still reach and a per-file grep for the
 * name would pass while the reach existed. That is also why src/lists has
 * its own answer normalizer rather than sharing src/answers.js, which
 * imports the sealing code — the duplication is the price of the guarantee.
 *
 * WHY THIS IS NOT A LOGBOOK WITH SWITCHES. The hard rules of the archive
 * are append-only, sealing, and approval before publication. A hard rule
 * with a boolean in front of it is not a hard rule, and the failure case is
 * somebody flipping a switch on an existing logbook and silently losing the
 * guarantee the whole project rests on. Separate tables, separate module,
 * separate vocabulary: AN ENTRY IS NOT A REPORT.
 *
 * THE RISK THAT RUNS THE OTHER WAY, and it is worth naming here because
 * this file is where somebody starts: a general form builder invites an
 * operator to build the wrong thing — to collect firsthand accounts in a
 * list, unsealed and sweepable, because the list builder was right there
 * and did not ask for consent tiers or a moderator. The gate in fields.js
 * is what stops that being anonymous and unerasable, and the container has
 * to be the FIRST question a builder asks, in plain language about what
 * each one guarantees. Nobody should reach a list by default.
 */

/* The rules. Pure, no database, so `npm test` can reach all of them. */
export {
  PERSONAL_KINDS, IMPERSONAL_KINDS, FORBIDDEN_KINDS, AGGREGATABLE_KINDS, LINK_KINDS,
  isPersonalKind, defaultRetention, isCollected, hasClosedVocabulary,
  collectionRequirements, assertFieldDefinition, assertCollectable,
} from './fields.js';
export {
  CLASSES, PROFILES, PROFILE_IDS, NEVER,
  personalRetentionDays, personalExpiresAt, saltRetentionDays,
  DEFAULT_PERSONAL_DAYS, DEFAULT_SALT_DAYS,
} from './retention.js';
export { normalizeUrl, urlKey, SHORTENERS, TRACKING_PARAMS, REJECTIONS } from './urls.js';
export { normalizeValue, MAX_SHORT_TEXT, MAX_LONG_TEXT } from './values.js';
export {
  REVIEW_STATES, TRIAGE_STATES, ERASABLE_COLUMNS,
  erasureExpiry, prepareAnswers, DEFAULT_DURABLE_LINK_DAYS,
} from './policy.js';
export { clustersIn } from './review.js';
export {
  parseListTemplate, shippedTemplates, LIST_FILE_VERSION, EMAIL_MODES,
} from './templates.js';

/* The write and read paths. These import src/db.js. */
export { utcDay, saltForDay, hashAddress, forgetCachedSalts } from './salt.js';
export { fileEntry, listBySlug, isAccepting } from './entries.js';
export { mintErasureToken, redeemErasureToken, erasePersonal } from './erasure.js';
export { sweepPersonal, sweepSalts, sweepErasureTokens, sweepLists } from './sweep.js';
export { applyListTemplate } from './templates.js';
export {
  aggregatableFields, definitionOf, totalsFor, fieldValueCounts, summaryFor,
  crossTabFor, loadList, linkCounts, snapshotDocument, SNAPSHOT_FORMAT,
} from './aggregates.js';
export {
  reviewBatch, reviewEntries, setTriageState, pendingCount,
} from './review.js';
export {
  allLists, listById, describe, templateChoices, createFromTemplate,
  updateSettings, replaceFields, deleteUnused, reviewQueues, ListRefusal, VISIBILITIES, OUTSIDE,
} from './manage.js';
export {
  recipientFor, nameRecipient, confirmRecipient, entryMail, CONFIRM_DAYS,
} from './notify.js';
