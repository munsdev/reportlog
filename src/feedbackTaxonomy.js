// Vocabulary for the in-app feedback tracker. Kept separate from
// taxonomy.js — that one is the report vocabulary, which is evidentiary
// and hashed into the chain; nothing here is.

export const FEEDBACK_TYPES = ['bug', 'question', 'suggestion'];

// Blocker/major/minor rather than a numeric priority: testers can pick
// these correctly without being told what P1 means.
export const FEEDBACK_SEVERITIES = ['blocker', 'major', 'minor'];

export const FEEDBACK_STATUSES = [
  'new',           // filed, not yet looked at
  'investigating', // acknowledged, being reproduced
  'in_progress',   // being fixed
  'need_info',     // waiting on the reporter (chase them on Signal)
  'acknowledged',  // noted, no fix needed — closes a suggestion or question
  'fixed',
  'wont_fix',
  'duplicate',
];

// Everything that still needs something from someone. Drives the admin
// tab badge and the weekly stale digest — if it's open it's on the list.
export const OPEN_FEEDBACK_STATUSES = ['new', 'investigating', 'in_progress', 'need_info'];

export const FEEDBACK_STATUS_LABELS = {
  new: 'New',
  investigating: 'Investigating',
  in_progress: 'In progress',
  need_info: 'Needs more info',
  acknowledged: 'Acknowledged',
  fixed: 'Fixed',
  wont_fix: "Won't fix",
  duplicate: 'Duplicate',
};

export const MAX_TITLE_LEN = 200;
export const MAX_BODY_LEN = 5000;
