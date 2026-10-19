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
  correct: 'Corrected it',
  erase: 'Erased their contact details',
};
