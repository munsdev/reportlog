/**
 * At the door (Plan E, session PE2): what a report or tip form asks of the
 * server before it can send, and the fields it sends with it.
 *
 * IN FRONT OF THE SITE PASSWORD, both reads (apps/api/src/identity/gate.ts's
 * IN_FRONT): a form on a door needs them, and neither says anything about what
 * is behind the password. A challenge is a signed random puzzle; a start token
 * is a signed moment.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

/** Where the widget fetches a challenge from. The widget is given this path. */
export const DOOR_CHALLENGE_PATH = '/api/door/challenge';

/**
 * The challenge, passed to the widget exactly as the server made it: its
 * parameters are signed, so a field dropped on the way would fail the check.
 */
export const getDoorChallenge = defineRoute({
  method: 'GET',
  path: DOOR_CHALLENGE_PATH,
  summary: 'A proof-of-work puzzle for the next report or tip. Signed, single use, expires.',
  response: z.object({
    parameters: z.record(z.string(), z.unknown()),
    signature: z.string(),
  }),
});

export const getDoorStart = defineRoute({
  method: 'GET',
  path: '/api/door/start',
  summary:
    'A start token for a form that has just opened: a signed moment and nothing else. A form sent too soon after it is refused.',
  response: z.object({ start: z.string() }),
});

/**
 * What every report and tip carries besides its answers. Loosely typed, as
 * the rest of a submission is: a refusal at the door is one plain sentence
 * from the server, never a schema error that names the field.
 */
export const DoorFields = {
  /** A box nobody can see. Anything in it is refused. */
  website: z.string().optional(),
  /** From GET /api/door/start, when the form opened. */
  start: z.string().optional(),
  /** The widget's solution to GET /api/door/challenge. */
  altcha: z.string().optional(),
};

export const DOOR_REFUSAL_CODE = 'try_again';

// ── administrators ──────────────────────────────────────────────────────

export const DoorSettings = z.object({
  /** A form sent sooner than this many seconds after it opened is refused. */
  min_form_seconds: z.number(),
  /** How hard the puzzle is. The moderators' "Harder puzzle" switch sets `harder`. */
  puzzle: z.enum(['normal', 'harder']),
});
export type DoorSettings = z.infer<typeof DoorSettings>;

export const getDoorSettings = defineRoute({
  method: 'GET',
  path: '/api/admin/door',
  summary: 'The door’s settings, and refusals at it in the last 24 hours, by hour and check.',
  response: DoorSettings.extend({
    refusals: z.array(z.object({ hour: z.string(), check: z.string(), count: z.number() })),
  }),
});

export const setDoorSettings = defineRoute({
  method: 'PUT',
  path: '/api/admin/door',
  summary: 'Change the minimum time on a form, or the puzzle’s difficulty.',
  body: z.object({
    min_form_seconds: z.number().optional(),
    puzzle: z.string().optional(),
  }),
  response: DoorSettings,
});
