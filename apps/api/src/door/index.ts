/**
 * AT THE DOOR: the cheap checks every report and tip passes before anything
 * of it is read or stored (brief §02, Plan E "At the door").
 *
 *   rate      reports and tips per network address, per minute and per hour,
 *             counted under a daily-keyed hash that lives only in memory
 *             (clients.ts, limits.ts)
 *   honeypot  a box hidden from people; anything in it is refused
 *   start     the form was open for at least the door's minimum (start.ts)
 *   puzzle    a valid, unexpired, unused ALTCHA solution (puzzle.ts)
 *
 * And for every request of any kind, a much higher per-address limit, so a
 * flood of submissions cannot stop the archive being read.
 *
 * A REFUSAL NEVER SAYS WHICH CHECK FAILED. Every one is the same status class,
 * code and sentence (the operator's `refusal_message`, "Something went wrong.
 * Please try again." until written), so whatever is probing learns nothing
 * from the answer about what to change. Each refusal is counted by check, and
 * the refused content is not stored anywhere: the checks run before the
 * submission is read. A person who meets one simply sends again: the page
 * fetches a fresh puzzle on its own.
 *
 * Nothing here is a third party: the puzzle is solved in the visitor's own
 * browser, by code served from this site, and checked here.
 */
import {
  DOOR_REFUSAL_CODE,
  getDoorChallenge,
  getDoorSettings,
  getDoorStart,
  setDoorSettings,
} from '@reportlog/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHmac, randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { roleGuard } from '../identity/guards.ts';
import { COPY_SLOTS } from '../site/copy.ts';
import { processHasher } from './clients.ts';
import type { ClientHasher } from './clients.ts';
import { rateLimiter } from './limits.ts';
import type { DoorLimits, RateLimiter } from './limits.ts';
import { issueChallenge, spendSolution } from './puzzle.ts';
import { countRefusal } from '../moderation/refusals.ts';
import { puzzleLevel } from '../moderation/switches.ts';
import { doorSettings, writeDoorSettings } from './settings.ts';
import { checkStart, issueStart } from './start.ts';

export interface Door {
  /**
   * Every check, in order, on a report or tip about to be read. Throws the one
   * plain refusal, after counting it, or returns and the route carries on.
   */
  pass(request: FastifyRequest, body: DoorBody): Promise<void>;
  /** The keyed hash of this request's address, for any other per-client limit. */
  client(request: FastifyRequest): string;
  /** Count a refusal made after the door (a strict reading of the answers, say). */
  count(check: RefusalCheck): Promise<void>;
}

/**
 * Every check the door can refuse on, by the name it is counted under
 * (moderation/refusals.ts, the flood screen's "refusals per hour").
 */
export type RefusalCheck =
  | 'honeypot'
  | 'start_missing'
  | 'too_fast'
  | 'puzzle_missing'
  | 'puzzle_wrong'
  | 'puzzle_expired'
  | 'puzzle_reused'
  | 'rate_minute'
  | 'rate_hour'
  | 'requests';

export interface DoorBody {
  website?: string | undefined;
  start?: string | undefined;
  altcha?: string | undefined;
}

export interface DoorDeps {
  db: Kysely<DB>;
  /** DOOR_KEY. Unset, a key is made in memory now (config.ts says what that costs). */
  key?: string | undefined;
  limits: DoorLimits;
  hasher?: ClientHasher;
  now?: () => number;
}

const FALLBACK_REFUSAL =
  COPY_SLOTS.find((s) => s.key === 'refusal_message')?.fallback ??
  'Something went wrong. Please try again.';

/** The operator's sentence for a refusal at the door, or what ships. */
async function refusalSentence(db: Kysely<DB>): Promise<string> {
  try {
    const row = await db
      .selectFrom('site_copy')
      .select('body')
      .where('key', '=', 'refusal_message')
      .executeTakeFirst();
    return row?.body.trim() ? row.body.trim() : FALLBACK_REFUSAL;
  } catch {
    return FALLBACK_REFUSAL;
  }
}

export function makeDoor(deps: DoorDeps): Door & {
  limiter: RateLimiter;
  hasher: ClientHasher;
  secrets: { puzzle: string; start: Buffer };
  keyWasMade: boolean;
} {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const master = deps.key ? Buffer.from(deps.key, 'base64') : randomBytes(32);
  // Two keys from one, so a puzzle signature can never pass for a start token.
  const sub = (label: string) => createHmac('sha256', master).update(label).digest();
  const secrets = { puzzle: sub('altcha-challenge').toString('hex'), start: sub('form-start') };
  const hasher = deps.hasher ?? processHasher;
  const limiter = rateLimiter(hasher, deps.limits, now);

  // Counting never turns a refusal into an error, nor answers differently.
  const count = async (check: RefusalCheck) => {
    try {
      await countRefusal(db, check);
    } catch {
      // See above.
    }
  };
  const refuse = async (check: RefusalCheck): Promise<never> => {
    await count(check);
    throw new HttpError(
      check.startsWith('rate_') ? 429 : 400,
      DOOR_REFUSAL_CODE,
      await refusalSentence(db),
    );
  };

  return {
    limiter,
    hasher,
    secrets,
    keyWasMade: !deps.key,
    client: (request) => hasher.of(request.ip),
    count,
    async pass(request, body) {
      const rate = limiter.submit(request.ip);
      if (rate) await refuse(rate);
      if (typeof body.website === 'string' && body.website.trim()) await refuse('honeypot');
      const settings = await doorSettings(db);
      const start = checkStart(secrets.start, body.start, settings.minFormMs, now());
      if (start) await refuse(start);
      const puzzle = await spendSolution(db, secrets.puzzle, body.altcha, now());
      if (puzzle) await refuse(puzzle);
    },
  };
}

const DOORS = new WeakMap<FastifyInstance, ReturnType<typeof makeDoor>>();

/** An app's door, for the tests that file through its routes (test/door-pass.ts). */
export function doorOf(app: FastifyInstance): ReturnType<typeof makeDoor> | undefined {
  return DOORS.get(app);
}

/** The door's own routes, and the per-address limit on every request. Registered first. */
export function doorRoutes(
  app: FastifyInstance,
  door: ReturnType<typeof makeDoor>,
  db: Kysely<DB>,
) {
  DOORS.set(app, door);
  if (door.keyWasMade) {
    app.log.warn(
      'DOOR_KEY is not set: the door signs with a key made at start, so a restart refuses every form already open.',
    );
  }
  // A quiet night still drops yesterday's hashing key and counters (clients.ts).
  const timer = setInterval(() => {
    door.hasher.tick();
  }, 60_000);
  timer.unref();
  app.addHook('onClose', () => {
    clearInterval(timer);
    return Promise.resolve();
  });

  // EVERY REQUEST, a high limit: reading the archive must stay fast during a
  // flood, and one address must not be able to take that away from everybody
  // else. The health check is exempt, so the doctor and Caddy can always ask.
  app.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.url === '/api/health') return;
    const { over, first } = door.limiter.request(request.ip);
    if (!over) return;
    // Counted once per address per window: counting is a write, and a flood
    // of writes is what this is here to stop.
    if (first) await door.count('requests');
    return reply
      .status(429)
      .header('retry-after', '60')
      .send({
        error: {
          code: 'too_many',
          message: 'Too many requests from here just now. Wait a minute and try again.',
        },
      });
  });

  route(app, getDoorChallenge, async () => {
    const challenge = await issueChallenge(door.secrets.puzzle, await puzzleLevel(db));
    return {
      parameters: challenge.parameters as unknown as Record<string, unknown>,
      signature: challenge.signature ?? '',
    };
  });
  route(app, getDoorStart, () => ({ start: issueStart(door.secrets.start) }));

  void app.register((staff, _opts, done) => {
    staff.addHook('preHandler', roleGuard(['admin']));
    const present = async () => {
      const s = await doorSettings(db);
      return { min_form_seconds: s.minFormMs / 1000 };
    };
    // The puzzle's difficulty and the refusal counts are the moderators' flood
    // screen (moderation/floodRoutes.ts), with its step-up and its record.
    route(staff, getDoorSettings, present);
    route(staff, setDoorSettings, async ({ request }) => {
      const b = request.body as { min_form_seconds?: number };
      if (
        b.min_form_seconds !== undefined &&
        !(
          Number.isFinite(b.min_form_seconds) &&
          b.min_form_seconds >= 0 &&
          b.min_form_seconds <= 600
        )
      ) {
        throw new HttpError(400, 'min_form', 'The minimum time on a form is 0 to 600 seconds.');
      }
      await writeDoorSettings(db, {
        ...(b.min_form_seconds === undefined
          ? {}
          : { minFormMs: Math.round(b.min_form_seconds * 1000) }),
      });
      return present();
    });
    done();
  });
}
