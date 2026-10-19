/**
 * Configuration, read once and checked once.
 *
 * Nothing reads `process.env` anywhere else. A missing or malformed value
 * stops the server at start with a sentence naming it, rather than at the
 * first request that happens to need it.
 */
import { z } from 'zod';

/**
 * An env file written from a template leaves `KEY=` for every setting not
 * yet filled in. That is "not set", not "set to nothing", so an empty value
 * is treated as absent before it is checked.
 */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

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

  // --- email (apps/api/src/email/) -------------------------------------
  /**
   * `scaleway` sends. `off` sends nothing and writes each message to
   * standard error instead (workstream A's fallback, so a fresh install can
   * still sign its operator in); the doctor fails a server left on it.
   * MAIL_OUTBOX, for the browser tests, wins over both. Never inferred from
   * which keys happen to be present: a staging box must be able to hold
   * real keys and still be told not to send.
   */
  EMAIL_TRANSPORT: z.enum(['off', 'scaleway']).default('off'),
  EMAIL_FROM_ADDRESS: optional(z.email('EMAIL_FROM_ADDRESS must be an email address')),
  EMAIL_FROM_NAME: optional(z.string().max(100)),
  SCALEWAY_SECRET_KEY: optional(z.string()),
  SCALEWAY_PROJECT_ID: optional(z.uuid('SCALEWAY_PROJECT_ID is a UUID')),
  /** Transactional email is served from Paris. */
  SCALEWAY_REGION: z.enum(['fr-par']).default('fr-par'),
  /** Where a failed scheduled job is reported. Unset: the doctor is the only one who notices. */
  OPS_ALERT_EMAIL: optional(z.email('OPS_ALERT_EMAIL must be an email address')),

  // --- backups (apps/api/src/jobs/backup.ts) ---------------------------
  BACKUP_DIR: z.string().default('/var/backups/reportlog'),
  BACKUP_KEEP: z.coerce.number().int().min(1).default(14),
  BACKUP_MAX_AGE_HOURS: z.coerce.number().positive().default(48),
  /** Where the backup job records what it last did, for the doctor. */
  STATE_DIR: z.string().default('/var/lib/reportlog'),
  /**
   * age public keys (`age1…`), separated by spaces or commas. An off-site
   * copy is encrypted to these before it leaves the machine; the matching
   * private keys are kept off this server, so the server cannot read its
   * own off-site backups and neither can the storage provider.
   */
  BACKUP_AGE_RECIPIENTS: optional(z.string()),
  BACKUP_S3_ENDPOINT: optional(z.url('BACKUP_S3_ENDPOINT is a URL')),
  BACKUP_S3_REGION: optional(z.string()),
  BACKUP_S3_BUCKET: optional(z.string()),
  BACKUP_S3_PREFIX: z.string().default('reportlog/'),
  BACKUP_S3_ACCESS_KEY_ID: optional(z.string()),
  BACKUP_S3_SECRET_ACCESS_KEY: optional(z.string()),

  // --- the daily anchor (apps/api/src/anchor/) -------------------------
  /**
   * The daily anchor (apps/api/src/anchor/). The RFC 3161 authority asked to
   * timestamp the list of chain heads: DFN's, in Germany, unless changed.
   * https only; plain http is allowed for a stand-in on this machine.
   */
  TSA_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .url()
      .refine(
        (u) => u.startsWith('https://') || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(u),
        'TSA_URL is an https address, like "https://zeitstempel.dfn.de"',
      )
      .default('https://zeitstempel.dfn.de'),
  ),
  /** The checkout of the public transparency log on this server: an absolute path. */
  TRANSPARENCY_LOG_DIR: optional(
    z.string().refine((s) => s.startsWith('/'), 'TRANSPARENCY_LOG_DIR is an absolute path'),
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
  TRANSPARENCY_LOG_SSH_KEY: optional(
    z.string().refine((s) => s.startsWith('/'), 'TRANSPARENCY_LOG_SSH_KEY is an absolute path'),
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

/**
 * Settings that only make sense together. A half-configured transport
 * looks set in the file and fails at the first send, which on this site is
 * somebody trying to confirm a report.
 */
const CheckedConfigSchema = ConfigSchema.superRefine((c, ctx) => {
  const need = (keys: (keyof typeof c)[], because: string) => {
    for (const key of keys) {
      if (c[key] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: because });
    }
  };
  if (c.EMAIL_TRANSPORT === 'scaleway') {
    need(
      ['SCALEWAY_SECRET_KEY', 'SCALEWAY_PROJECT_ID', 'EMAIL_FROM_ADDRESS'],
      'required when EMAIL_TRANSPORT=scaleway',
    );
  }
  const offsite = [
    'BACKUP_S3_ENDPOINT',
    'BACKUP_S3_REGION',
    'BACKUP_S3_BUCKET',
    'BACKUP_S3_ACCESS_KEY_ID',
    'BACKUP_S3_SECRET_ACCESS_KEY',
  ] as const;
  if (offsite.some((k) => c[k] !== undefined)) {
    need([...offsite], 'off-site backups need all five BACKUP_S3_ settings');
    // Never a plaintext copy of the archive on somebody else's disks.
    need(['BACKUP_AGE_RECIPIENTS'], 'off-site backups are encrypted, so a recipient is required');
  }
});

export type Config = z.infer<typeof CheckedConfigSchema>;

/** Every setting's name. A test holds `.env.example` to documenting each one. */
export const CONFIG_KEYS: readonly string[] = Object.keys(ConfigSchema.shape);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = CheckedConfigSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`The server's configuration is not usable:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
