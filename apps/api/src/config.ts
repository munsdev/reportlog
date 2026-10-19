/**
 * Configuration, read once and checked once.
 *
 * Nothing reads `process.env` anywhere else. A missing or malformed value
 * stops the server at start with a sentence naming it, rather than at the
 * first request that happens to need it.
 */
import { z } from 'zod';

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (postgres://...)'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /**
   * The prefix of every public reference this archive issues. It is sealed
   * into every report, so it is set once and never changed.
   */
  PUBLIC_REF_PREFIX: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{0,7}-$/, 'PUBLIC_REF_PREFIX looks like "RL-"')
    .default('RL-'),
  /** Where the website is, for the links in emails (an invitation, say). */
  SITE_ORIGIN: z
    .url('SITE_ORIGIN looks like "https://reports.example.org"')
    .transform((s) => s.replace(/\/+$/, ''))
    .default('http://127.0.0.1:5173'),
  /**
   * A directory to write outgoing email into instead of sending it. For the
   * browser tests only, which need to read what a person would have been sent.
   */
  MAIL_OUTBOX: z.string().min(1).optional(),
  /**
   * How many proxies stand in front of the server (Caddy is one). Without it
   * every visitor has the proxy's address, and a limit meant for one client
   * becomes one limit for the whole site.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /**
   * Lists (apps/api/src/lists/). How many days the personal half of a list
   * entry is kept before the sweep erases it, or "never" (then only the
   * person's own erasure link removes it). A typo stops the server here
   * rather than quietly turning retention off.
   */
  LIST_PERSONAL_DAYS: z
    .string()
    .trim()
    .regex(/^(never|[1-9]\d{0,4})$/i, 'LIST_PERSONAL_DAYS is a number of days, like 90, or "never"')
    .optional(),
  /** Days a day's address-hashing secret is kept before it is destroyed. */
  LIST_SALT_DAYS: z.coerce.number().int().min(1).max(30).default(2),
  /** Days an erasure link lasts where nothing is erased on its own ("never" above). */
  LIST_ERASURE_LINK_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
  /** Link hosts a moderator knows, comma-separated. Others are marked for their eye. */
  LIST_KNOWN_HOSTS: z.string().default(''),
  /** Where a list's new entries go when it names no address of its own. */
  ADMIN_EMAIL: z.preprocess(
    (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
    z.email('ADMIN_EMAIL looks like "office@example.org"').optional(),
  ),
  /**
   * The key every report's contact key is wrapped under, and the address
   * digest is keyed with: 32 random bytes, base64 (`openssl rand -base64 32`).
   * Losing it makes every reporter's address unreadable; it is never sealed.
   * Without it the site runs but takes no reports, and says so.
   */
  CONTACT_KEY: z
    .string()
    .refine(
      (s) => Buffer.from(s, 'base64').length === 32,
      'CONTACT_KEY is 32 random bytes, base64 (openssl rand -base64 32)',
    )
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`The server's configuration is not usable:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
