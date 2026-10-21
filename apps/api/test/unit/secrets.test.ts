/**
 * KEYS AND SECRETS ARE PART OF SETTING UP A SERVER, NEVER OF THIS REPOSITORY
 * (docs/decisions.md, "Keys and secrets").
 *
 * Every secret setting is named here once, with who provides it on a server.
 * The tests hold the rest of the rule to that list:
 *   - a setting whose name says it is a key, secret, token or DSN is on the
 *     list, or on NOT_SECRET with the reason;
 *   - .env.example has each one blank, and the server starts with them blank;
 *   - an installer makes or asks for each one, so nobody edits a file by hand;
 *   - the application reads them only through config.ts, from the one env
 *     file systemd and the deploy scripts hand it, /etc/reportlog/reportlog.env.
 *
 * That none is ever committed is CI's secret scan (.gitleaks.toml,
 * secret-scan.test.ts).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_KEYS, loadConfig } from '../../src/config.ts';
import { REPO } from './deploy-sandbox.ts';

type Source =
  'made by install.sh' | 'asked by install.sh' | 'set by install-bugsink.sh' | 'rotation';

const SECRETS: Record<string, Source> = {
  CONTACT_KEY: 'made by install.sh',
  FILES_KEY: 'made by install.sh',
  DOOR_KEY: 'made by install.sh',
  // Typed by a person only while rotating the contact key, then removed
  // (deploy/README.md, "Rotating the contact key").
  CONTACT_KEY_PREVIOUS: 'rotation',
  SCALEWAY_SECRET_KEY: 'asked by install.sh',
  BACKUP_S3_ACCESS_KEY_ID: 'asked by install.sh',
  BACKUP_S3_SECRET_ACCESS_KEY: 'asked by install.sh',
  S3_ACCESS_KEY: 'asked by install.sh',
  S3_SECRET_KEY: 'asked by install.sh',
  // An https address may carry a token.
  TRANSPARENCY_LOG_REMOTES: 'asked by install.sh',
  // Its user part is the project's key.
  ERROR_TRACKING_DSN: 'set by install-bugsink.sh',
};

/** Names that look secret and are not, each with the reason. */
const NOT_SECRET: Record<string, string> = {
  TRANSPARENCY_LOG_SSH_KEY:
    'a path. The key file it names is made by install.sh under /var/lib/reportlog, 0600, and is never in the repository.',
};

const read = (f: string) => readFileSync(join(REPO, f), 'utf8');
const example = read('.env.example');

/** .env.example as node's --env-file reads it: KEY=value lines, comments ignored. */
function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m?.[1]) env[m[1]] = m[2] ?? '';
  }
  return env;
}

function filesUnder(dir: string, keep: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(REPO, dir))) {
    const rel = join(dir, name);
    if (statSync(join(REPO, rel)).isDirectory()) out.push(...filesUnder(rel, keep));
    else if (keep(rel)) out.push(rel);
  }
  return out;
}

describe('the list of secrets', () => {
  it('names every setting that looks like one, or says why it is not', () => {
    const looks = CONFIG_KEYS.filter((k) => /KEY|SECRET|TOKEN|PASSWORD|DSN|REMOTES/.test(k));
    expect(looks.filter((k) => !(k in SECRETS) && !(k in NOT_SECRET))).toEqual([]);
  });

  it('names only settings the server reads', () => {
    for (const k of [...Object.keys(SECRETS), ...Object.keys(NOT_SECRET)]) {
      expect(CONFIG_KEYS, k).toContain(k);
    }
  });
});

describe('.env.example', () => {
  it('has every secret blank, once, and no example value for one anywhere', () => {
    for (const k of Object.keys(SECRETS)) {
      const lines = example.split('\n').filter((l) => new RegExp(`^(# )?${k}=`).test(l));
      expect(lines, k).toEqual([`${k}=`]);
    }
  });

  it('starts a server with every secret blank: blank is "not set", never an error', () => {
    const config = loadConfig(parseEnv(example));
    for (const k of Object.keys(SECRETS)) {
      const v = (config as Record<string, unknown>)[k];
      expect(v === undefined || (Array.isArray(v) && v.length === 0), k).toBe(true);
    }
  });
});

describe('who provides each secret on a server', () => {
  // Continuation lines joined, so a call split over two lines reads as one.
  const install = read('deploy/install.sh').replace(/\\\n\s*/g, '');
  const bugsink = read('deploy/install-bugsink.sh');

  it('is an installer, writing it into the settings file, never a person editing it', () => {
    for (const [k, source] of Object.entries(SECRETS)) {
      if (source === 'made by install.sh') {
        expect(install, k).toMatch(new RegExp(`(set_env ${k} |s\\|\\^${k}=)`));
      } else if (source === 'asked by install.sh') {
        expect(install, k).toMatch(new RegExp(`ask_setting ${k} .* secret$`, 'm'));
      } else if (source === 'set by install-bugsink.sh') {
        expect(bugsink, k).toMatch(new RegExp(`set_env ${k} `));
      } else {
        expect(read('deploy/README.md'), k).toContain(`\`${k}=\``);
      }
    }
  });

  it('never prints one: the installers name settings, not values', () => {
    for (const [name, text] of [
      ['install.sh', install],
      ['install-bugsink.sh', bugsink],
    ] as const) {
      for (const k of Object.keys(SECRETS)) {
        // `note "... $KEY"` or echo of env_value would print a value.
        expect(text, `${name}: ${k}`).not.toMatch(
          new RegExp(`(echo|note|printf)[^\\n]*\\$\\(env_value ${k}\\)`),
        );
      }
    }
  });
});

describe('where the application reads them from', () => {
  it('only through config.ts: nothing else in the server reads a secret from the environment', () => {
    const sources = filesUnder('apps/api/src', (f) => f.endsWith('.ts')).filter(
      (f) => !f.endsWith('/config.ts'),
    );
    expect(sources.length).toBeGreaterThan(50);
    for (const f of sources) {
      const text = read(f);
      for (const k of Object.keys(SECRETS)) {
        expect(text, `${f} reads ${k} from the environment`).not.toMatch(
          new RegExp(`process\\.env(\\.${k}\\b|\\[['"\`]${k})`),
        );
      }
    }
  });

  it('from /etc/reportlog/reportlog.env: every unit and the deploy scripts pass that file and no other', () => {
    const units = filesUnder('deploy/systemd', (f) => /\.(service|conf)$/.test(f));
    expect(units.length).toBeGreaterThanOrEqual(4);
    for (const f of units) {
      const lines = read(f)
        .split('\n')
        .filter((l) => !l.startsWith('#'));
      for (const l of lines.filter((x) => /\bnode\b/.test(x) && x.startsWith('Exec'))) {
        expect(l, f).toContain('--env-file=/etc/reportlog/reportlog.env ');
      }
      expect(
        lines.filter((l) => l.startsWith('EnvironmentFile=')),
        f,
      ).toEqual([]);
      for (const k of Object.keys(SECRETS)) {
        expect(lines.join('\n'), `${f} sets ${k}`).not.toMatch(new RegExp(`\\b${k}=`));
      }
    }
    const lib = read('deploy/lib.sh');
    expect(lib).toMatch(/^ENV_FILE=\$ETC\/reportlog\.env$/m);
    expect(lib).toMatch(/^ETC=\/etc\/reportlog$/m);
    expect(lib).toContain('as_app "$NODE" --env-file="$ENV_FILE" "$@"');
  });

  it('and never from deploy.env, which is readable by every user on the server', () => {
    const deployEnv = parseEnv(read('deploy/deploy.env.example'));
    for (const k of Object.keys(SECRETS)) expect(deployEnv, k).not.toHaveProperty(k);
    // A token in the repository's address would sit in that file too.
    expect(deployEnv.REPO_URL).not.toMatch(/\/\/[^/]*@/);
  });

  it('nothing in deploy/ or the workflows gives a secret a value', () => {
    const files = [
      ...filesUnder('deploy', (f) => !f.endsWith('requirements.txt')),
      ...filesUnder('.github', () => true),
    ];
    for (const f of files) {
      const text = read(f);
      for (const k of Object.keys(SECRETS)) {
        expect(text, `${f}: ${k}`).not.toMatch(
          new RegExp(`(^|\\s)(export\\s+)?${k}=[^\\s$"'\`]`, 'm'),
        );
      }
    }
  });
});
