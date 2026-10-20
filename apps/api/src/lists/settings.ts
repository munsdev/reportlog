/**
 * A list's settings, from the server's configuration (read and checked once,
 * in config.ts, like every other setting).
 */
import type { Config } from '../config.ts';
import { personalRetentionDays } from './retention.ts';
import type { ListSettings } from './retention.ts';

export function listSettingsFrom(
  config: Pick<
    Config,
    'LIST_PERSONAL_DAYS' | 'LIST_ERASURE_LINK_DAYS' | 'LIST_KNOWN_HOSTS' | 'ADMIN_EMAIL'
  >,
): ListSettings {
  return {
    personalDays: personalRetentionDays(config.LIST_PERSONAL_DAYS),
    erasureLinkDays: config.LIST_ERASURE_LINK_DAYS,
    knownHosts: config.LIST_KNOWN_HOSTS.split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    adminEmail: config.ADMIN_EMAIL?.trim().toLowerCase() ?? null,
  };
}
