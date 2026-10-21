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
  CONTACT_KEY: optional(
    z
      .string()
      .refine(
        (s) => Buffer.from(s, 'base64').length === 32,
        'CONTACT_KEY is 32 random bytes, base64 (openssl rand -base64 32)',
      ),
  ),
  /**
   * Only while CONTACT_KEY is being rotated (workstream C2): the key being
   * rotated away from. Read with, never written with; removed once
   * `reportlog contact-key rotate` has run (deploy/README.md).
   */
  CONTACT_KEY_PREVIOUS: z.preprocess(
    (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
    z
      .string()
      .refine(
        (s) => Buffer.from(s, 'base64').length === 32,
        'CONTACT_KEY_PREVIOUS is 32 random bytes, base64, like CONTACT_KEY',
      )
      .optional(),
  ),
  /**
   * Authenticator-app secrets (two-factor login, decision E3) are encrypted
   * under it: 32 random bytes, base64, made by install.sh. Its own key, not
   * CONTACT_KEY: losing or replacing it costs each staff member setting
   * their app up again (identity/twoFactorKey.ts). Without it passkeys still
   * work and the app cannot be set up.
   */
  TWO_FACTOR_KEY: optional(
    z
      .string()
      .refine(
        (s) => Buffer.from(s, 'base64').length === 32,
        'TWO_FACTOR_KEY is 32 random bytes, base64 (openssl rand -base64 32)',
      ),
  ),
  /**
   * Files (apps/api/src/files/). The key every file's own key is wrapped
   * under: 32 random bytes, base64. NOT the same as CONTACT_KEY: the media
   * worker holds this one and parses hostile files. Losing it makes every
   * stored file unreadable. Without it, or without storage, no file is taken
   * and the form does not offer the upload question.
   */
  FILES_KEY: optional(
    z
      .string()
      .refine(
        (s) => Buffer.from(s, 'base64').length === 32,
        'FILES_KEY is 32 random bytes, base64 (openssl rand -base64 32)',
      ),
  ),
  /** Where file bytes live: a directory (development, tests) or S3-compatible storage. */
  FILES_STORAGE: z.enum(['disk', 's3']).optional(),
  /** The directory, for FILES_STORAGE=disk. */
  FILES_DIR: z.string().min(1).default('.files'),
  S3_ENDPOINT: optional(z.url('S3_ENDPOINT looks like "https://fsn1.your-objectstorage.com"')),
  S3_REGION: z.string().min(1).default('eu-central-1'),
  S3_ACCESS_KEY: optional(z.string().min(1)),
  S3_SECRET_KEY: optional(z.string().min(1)),
  S3_BUCKET_STAGING: optional(z.string().min(1)),
  S3_BUCKET_EVIDENCE: optional(z.string().min(1)),
  S3_BUCKET_RENDITIONS: optional(z.string().min(1)),
  S3_ADDRESSING: z.enum(['path', 'virtual']).default('path'),
  /**
   * Whether files are taken when an administrator has not said. Their own
   * switch (file_settings) wins either way.
   */
  ATTACHMENTS_ENABLED: z.enum(['true', 'false']).optional(),
  /**
   * Run the media worker inside the server process, polling. For development
   * and the browser tests only; a deployment runs `files:worker` on its own.
   */
  FILES_INLINE_WORKER: z.enum(['true', 'false']).default('false'),
  /** Scan with clamdscan before anything else touches a file. */
  CLAMAV_ENABLED: z.enum(['true', 'false']).default('false'),
  /** How many reports' worth of files one address may have staged at once. 0 is no limit. */
  FILES_STAGING_QUOTA_REPORTS: z.coerce.number().int().min(0).max(100).default(3),

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
  /**
   * The press pack: a folder holding manifest.json and the files it lists,
   * built ahead of time (board/press.ts). Unset is no pack.
   */
  PRESS_DIR: optional(z.string().refine((s) => s.startsWith('/'), 'PRESS_DIR is an absolute path')),
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
  /**
   * Reports one client may send for confirmation in 15 minutes. Anybody can
   * make the site email any address they type, so this stays low on a real
   * site. The browser suite raises it: every test files from 127.0.0.1.
   */
  FILING_SENDS_PER_CLIENT: z.coerce.number().int().min(1).max(1000).default(20),

  /**
   * Times one client may open or use confirmation links in 15 minutes. A
   * link is a long random token, so this only slows a guesser down. The
   * browser suite raises it, for the same reason as the one above.
   */
  FILING_CONFIRMS_PER_CLIENT: z.coerce.number().int().min(1).max(1000).default(60),

  // --- at the door (apps/api/src/door/) --------------------------------
  /**
   * The key the door's puzzles and form start tokens are signed with: 32
   * random bytes, base64 (`openssl rand -base64 32`). Nothing signed with it
   * outlives a day, so losing it costs nothing but the forms open at that
   * moment. Unset, the server makes one in memory at start and says so: the
   * door is never off, but a restart then refuses every form already open.
   */
  DOOR_KEY: optional(
    z
      .string()
      .refine(
        (s) => Buffer.from(s, 'base64').length === 32,
        'DOOR_KEY is 32 random bytes, base64 (openssl rand -base64 32)',
      ),
  ),
  /**
   * Reports and tips one network address may send (owner decision E2), per
   * minute and per hour. Counted under a keyed hash whose key changes daily
   * and lives only in memory. Start low and tune in the rehearsal (brief
   * §09); the browser suite raises both, since every test sends from 127.0.0.1.
   */
  DOOR_SUBMITS_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(6),
  DOOR_SUBMITS_PER_HOUR: z.coerce.number().int().min(1).max(1_000_000).default(60),
  /**
   * Requests of any kind one network address may make per minute: far higher,
   * so reading the archive stays fast during a flood of submissions.
   */
  DOOR_REQUESTS_PER_MINUTE: z.coerce.number().int().min(10).max(1_000_000).default(600),

  /** Hours after which the newest anchor counts as stale (the job runs daily). */
  ANCHOR_MAX_AGE_HOURS: z.coerce
    .number()
    .min(25)
    .max(24 * 14)
    .default(36),

  // --- error tracking (apps/api/src/telemetry/) ------------------------
  /**
   * A Bugsink project's DSN (`https://<key>@bugsink.example.org/<project>`).
   * Unset, nothing is tracked and nothing is sent anywhere. Set, the server
   * reports its own unexpected errors there, and relays the website's
   * (the browser never talks to Bugsink). A secret: never logged.
   */
  ERROR_TRACKING_DSN: optional(
    z
      .url('ERROR_TRACKING_DSN looks like "https://key@bugsink.example.org/1"')
      .refine(
        (u) => /^https?:\/\/[^@/\s]+@[^/\s]+\/(?:.*\/)?\d+$/.test(u),
        'ERROR_TRACKING_DSN looks like "https://key@bugsink.example.org/1": a key, a host and a project number',
      ),
  ),
  /** Shown beside each event in Bugsink, to tell a staging server from the real one. */
  ERROR_TRACKING_ENVIRONMENT: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9_-]{0,31}$/,
      'ERROR_TRACKING_ENVIRONMENT is a short name, like "production"',
    )
    .default('production'),
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
