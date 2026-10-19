/** What each state is called on screen. One place, so the screens agree. */
export const STATUS_WORDS: Record<string, string> = {
  pending: 'Waiting for a moderator',
  valid: 'Approved',
  invalid: 'Declined',
  unknown: 'Unclear',
  withdrawn: 'Withdrawn',
  all: 'Everything',
};

export const ACTION_WORDS: Record<string, string> = {
  review: 'Decided',
  withdraw: 'Withdrew it',
  restore: 'Put it back',
  reviewed: 'Read the flagged report',
  note: 'Wrote a note',
  note_revised: 'Revised the note',
  note_state: 'Changed the note’s state',
  note_link: 'Changed a citation',
  files: 'Decided about the files',
  severity: 'Rated its severity',
  incident: 'Changed its incident link',
  correct: 'Corrected it',
  erase: 'Erased their contact details',
};

/**
 * How serious a moderator judged a report. Legacy's labels; its hints named
 * voting, which nothing says a deployment is about, so they are general here.
 */
export const SEVERITY_WORDS: Record<string, { label: string; hint: string }> = {
  note: { label: 'Procedural note', hint: 'Worth recording, no apparent harm' },
  irregularity: { label: 'Irregularity', hint: 'Departure from procedure, limited effect' },
  serious: { label: 'Serious', hint: 'Somebody was, or could have been, harmed or shut out' },
  systemic: {
    label: 'Apparent violation or systemic',
    hint: 'Looks unlawful, or repeated across places',
  },
  none: { label: 'Not rated yet', hint: 'Nobody has rated it' },
};

export const SEVERITIES = ['note', 'irregularity', 'serious', 'systemic'] as const;
