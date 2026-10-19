import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');
const setting = (text: string, key: string) => new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1];

describe('deploy/versions.conf', () => {
  const pins = read('deploy/versions.conf');

  it('pins the Node major the repository is developed and tested on', () => {
    const version = setting(pins, 'NODE_VERSION') ?? '';
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(version.split('.')[0]).toBe(read('.nvmrc').trim());
  });

  it('pins a SHA-256 for each architecture and full key fingerprints', () => {
    for (const key of ['NODE_SHA256_X64', 'NODE_SHA256_ARM64']) {
      expect(setting(pins, key), key).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const key of ['PGDG_KEY_FINGERPRINT', 'CADDY_KEY_FINGERPRINT']) {
      expect(setting(pins, key), key).toMatch(/^[0-9A-F]{40}$/);
    }
    expect(setting(pins, 'POSTGRES_MAJOR')).toBe('16');
  });
});

describe('deploy/caddy/Caddyfile', () => {
  const caddy = read('deploy/caddy/Caddyfile');
  const directives = caddy
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  it('writes no access log: a log of addresses and paths is a visitor list', () => {
    expect(directives.filter((l) => /^log\b/.test(l))).toEqual([]);
  });

  it('does not hand the API the client address', () => {
    expect(directives).toContain('header_up -X-Forwarded-For');
  });

  it('allows nothing from another host on the website', () => {
    const csp = /Content-Security-Policy "([^"]+)"/.exec(caddy)?.[1] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/https?:/);
  });
});

describe('PostgreSQL', () => {
  it('is configured with no TCP listener at all', () => {
    expect(read('deploy/postgres/reportlog.conf')).toMatch(/^listen_addresses = ''$/m);
  });
});
