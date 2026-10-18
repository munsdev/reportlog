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
