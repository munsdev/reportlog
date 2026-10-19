/**
 * Configuration, read once and checked once.
 *
 * Nothing reads `process.env` anywhere else. A missing or malformed value
 * stops the server at start with a sentence naming it, rather than at the
 * first request that happens to need it.
 */
import { z } from 'zod';

/** An empty value in an env file means "not set", not "set to nothing". */
const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && !v.trim() ? undefined : v), schema);

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
  /**
   * The daily anchor (apps/api/src/anchor/). The RFC 3161 authority asked to
   * timestamp the list of chain heads: DFN's, in Germany, unless changed.
   * https only; plain http is allowed for a stand-in on this machine.
   */
  TSA_URL: unsetIfEmpty(
    z
      .url()
      .refine(
        (u) => u.startsWith('https://') || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(u),
        'TSA_URL is an https address, like "https://zeitstempel.dfn.de"',
      )
      .default('https://zeitstempel.dfn.de'),
  ),
  /** The checkout of the public transparency log on this server: an absolute path. */
  TRANSPARENCY_LOG_DIR: unsetIfEmpty(
    z
      .string()
      .refine((s) => s.startsWith('/'), 'TRANSPARENCY_LOG_DIR is an absolute path')
      .optional(),
  ),
  /**
   * Where the log is pushed: git addresses, comma-separated, each pushed on
   * its own. An https address may carry its token
   * (https://user:token@host/owner/log.git); an ssh one uses
   * TRANSPARENCY_LOG_SSH_KEY. Secrets, so never logged.
   */
  TRANSPARENCY_LOG_REMOTES: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean),
    )
    .refine(
      (list) =>
        list.every((r) => /^(https:\/\/|ssh:\/\/|[^@\s/]+@[^:\s]+:|file:\/\/|\/)\S+$/.test(r)),
      'TRANSPARENCY_LOG_REMOTES is a comma-separated list of git addresses (https://, ssh:// or git@host:path)',
    ),
  TRANSPARENCY_LOG_BRANCH: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/, 'TRANSPARENCY_LOG_BRANCH is a branch name')
    .default('main'),
  /** A private key file for ssh remotes. Kept outside the database, mode 0600. */
  TRANSPARENCY_LOG_SSH_KEY: unsetIfEmpty(
    z
      .string()
      .refine((s) => s.startsWith('/'), 'TRANSPARENCY_LOG_SSH_KEY is an absolute path')
      .optional(),
  ),
  /** Who the log's commits are by. */
  TRANSPARENCY_LOG_AUTHOR_NAME: z.string().min(1).default('ReportLog anchor'),
  TRANSPARENCY_LOG_AUTHOR_EMAIL: z.email().default('anchor@reportlog.invalid'),
  /** Hours after which the newest anchor counts as stale (the job runs daily). */
  ANCHOR_MAX_AGE_HOURS: z.coerce
    .number()
    .min(25)
    .max(24 * 14)
    .default(36),
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
