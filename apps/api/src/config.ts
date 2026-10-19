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

  /**
   * The address people reach the site at, e.g. https://reports.example.org.
   * Every link in every email is built from it, and the doctor checks the
   * certificate it serves.
   */
  SITE_ORIGIN: optional(
    z
      .url({ protocol: /^https?$/, error: 'SITE_ORIGIN looks like "https://reports.example.org"' })
      .transform((v) => v.replace(/\/+$/, '')),
  ),

  // --- email (apps/api/src/email/) -------------------------------------
  /**
   * `scaleway` sends. `capture` keeps messages in memory (and in
   * EMAIL_CAPTURE_DIR if set) for tests. `off` sends nothing and says so.
   * Never inferred from which keys happen to be present: a staging box
   * must be able to hold real keys and still be told not to send.
   */
  EMAIL_TRANSPORT: z.enum(['off', 'capture', 'scaleway']).default('off'),
  EMAIL_FROM_ADDRESS: optional(z.email('EMAIL_FROM_ADDRESS must be an email address')),
  EMAIL_FROM_NAME: optional(z.string().max(100)),
  EMAIL_CAPTURE_DIR: optional(z.string()),
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
