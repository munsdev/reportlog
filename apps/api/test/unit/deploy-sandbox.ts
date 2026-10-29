/**
 * A pretend server for running deploy/*.sh in a test.
 *
 * The scripts name absolute paths (/srv/reportlog, /etc/systemd/system, ...)
 * and are run as root on a real server. Here they run against a temporary
 * directory standing in for `/`: each script is copied with exactly those
 * paths moved under the sandbox, and nothing else about it changes. A guard
 * fails the copy if a system path is left that the list below does not
 * move, so a new path in a script cannot quietly write to the machine that
 * runs the tests (which, in a cloud session, is root).
 *
 * The commands that would change a real machine (systemctl, apt-get, caddy,
 * runuser, chown, curl, ...) are stand-ins on PATH. Each records its
 * arguments, in order, to one log, and does what the test arranged through
 * files in `control/`. Files, symlinks, git, tar, flock, sed and install are
 * the real ones: what a script writes is real, and is what a test reads.
 *
 * The stand-ins read control files rather than environment variables
 * because the scripts run the application's commands under `env -i`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const REPO = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');

/** Every system path the scripts use, moved under the sandbox. Longest first. */
const MOVED = [
  '/usr/share/keyrings',
  '/usr/local/lib/reportlog',
  '/usr/local/bin',
  '/var/cache/reportlog-build',
  '/var/backups/reportlog',
  '/var/lib/reportlog',
  '/var/lib/bugsink',
  '/run/reportlog-deploy.lock',
  '/etc/systemd/system',
  '/etc/postgresql',
  '/etc/os-release',
  '/etc/reportlog',
  '/etc/bugsink',
  '/etc/caddy',
  '/etc/apt',
  '/srv/reportlog',
  '/opt',
];

/** System paths a script may name without touching the machine. */
const LEFT_ALONE = [
  /^\/dev\/(null|urandom)$/,
  /^\/usr\/bin$/,
  /^\/bin$/,
  /^\/usr\/sbin\/nologin$/,
  /^\/var\/run\/postgresql$/, // inside DATABASE_URL, and a message
  /^\/nonexistent$/,
];

/** A script's text with its system paths moved under `root`. */
export function rewrite(text: string, root: string): string {
  let out = text;
  for (const p of MOVED) {
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(
      new RegExp(`(^|[^A-Za-z0-9_.$}/-])${escaped}(?=$|[/"'\\s:;)\\]])`, 'gm'),
      `$1${root}${p}`,
    );
  }
  // The guard: no other absolute system path may remain outside a comment.
  const code = out
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  const left = [
    ...code.matchAll(
      /(?:^|[\s"'=:(>])(\/(?:etc|srv|var|usr|run|opt|root|home|lib|bin|dev|nonexistent)[^\s"';|)\]:]*)/gm,
    ),
  ]
    .map((m) => m[1] ?? '')
    .filter((p) => !p.startsWith(root))
    .map((p) => p.replace(/[.,]$/, ''))
    .filter((p) => !LEFT_ALONE.some((r) => r.test(p)));
  if (left.length) {
    throw new Error(
      `deploy-sandbox: a script names a system path the sandbox does not move: ${left.join(', ')}`,
    );
  }
  return out;
}

const STUB_HEAD = (log: string, name: string) => `#!/bin/bash
{ printf '%s' ${JSON.stringify(name)}; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >>${JSON.stringify(log)}
`;

/** What each stand-in does after recording its call. `$C` is the control directory, `$R` the root. */
const STUBS: Record<string, string> = {
  id: `case "$1" in
  -u) if [ -e "$C/not-root" ]; then echo 1000; else echo 0; fi ;;
  *) [ -e "$C/user-$1" ] ;;
esac`,
  runuser: `# runuser -u <user> -- <command...>
while [ "$1" != "--" ]; do shift; done; shift
exec "$@"`,
  chown: 'exit 0',
  systemctl: '[ ! -e "$C/systemctl-fails-$1" ]',
  journalctl: 'echo "(the journal would be here)"',
  caddy: `case "$1" in
  validate) if [ -e "$C/caddy-invalid" ]; then echo "Error: adapting config using caddyfile: bad"; exit 1; fi ;;
  version) echo "v2.10.2 h1:stand-in" ;;
esac`,
  curl: `for a in "$@"; do case "$a" in
  */api/health)
    rev=$(cat "$R/srv/reportlog/current/REVISION" 2>/dev/null)
    [ ! -e "$C/unhealthy-all" ] && [ ! -e "$C/unhealthy-$rev" ]
    exit ;;
  */accounts/login/) [ ! -e "$C/bugsink-down" ]; exit ;;
esac; done
# A download: curl -fsSL <url> -o <file>, served from control/downloads.
url=""; out=""
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2 ;; -*) shift ;; *) url=$1; shift ;; esac; done
src="$C/downloads/$(basename "$url")"
[ -e "$src" ] || { echo "curl: (22) 404 $url" >&2; exit 22; }
cp "$src" "$out"`,
  sleep: 'exit 0',
  'apt-get': 'exit 0',
  // A downloaded "key" holds its own fingerprint, which is all this reads.
  gpg: `for a in "$@"; do last=$a; done
case " $* " in
  *" --show-keys "*) echo "fpr:::::::::$(cat "$last"):" ;;
  *" --dearmor "*) while [ "$1" != "-o" ]; do shift; done; cp "$3" "$2" ;;
esac`,
  uname: 'if [ -e "$C/arch" ]; then cat "$C/arch"; else echo x86_64; fi',
  useradd: 'for a in "$@"; do last=$a; done; touch "$C/user-$last"',
  // ssh-keygen -q -t ed25519 -N '' -C <comment> -f <file>: a stand-in pair.
  'ssh-keygen': `while [ "$1" != "-f" ]; do shift; done
echo "stand-in private key" >"$2"
echo "ssh-ed25519 AAAAC3NzaStandIn reportlog anchor" >"$2.pub"`,
  // python3 -m venv <dir>: a "virtual environment" holding the stand-ins
  // for what pip would install (VENV_STUBS), so the script can run them.
  python3: `case "$*" in
  "-m venv "*) mkdir -p "$3/bin" && cp "$C/../venv-bin/"* "$3/bin/" ;;
  *) exit 1 ;;
esac`,
  psql: `case "$*" in
  *pg_roles*) [ -e "$C/pg-role" ] && echo 1 ;;
  *pg_database*) [ -e "$C/pg-database" ] && echo 1 ;;
esac; exit 0`,
  createuser: 'touch "$C/pg-role"',
  createdb: 'touch "$C/pg-database"',
  corepack: 'exit 0',
  // The real install, without -o/-g: there is no reportlog user here.
  install: `args=()
while [ $# -gt 0 ]; do case "$1" in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac; done
exec /usr/bin/install "\${args[@]}"`,
};

/** Bugsink's commands, as pip would have installed them into a venv. */
const VENV_STUBS: Record<string, string> = {
  pip: '[ ! -e "$C/pip-fails" ] || { echo "ERROR: THESE PACKAGES DO NOT MATCH THE HASHES" >&2; exit 1; }',
  'bugsink-manage': `echo "  (SECRET_KEY \${SECRET_KEY:+set}, BUGSINK_BASE_URL=\${BUGSINK_BASE_URL:-}, in $PWD)" >>"$L"
case " $* " in
  *" shell "*)
    case "$*" in
      *is_superuser*) if [ -e "$C/bugsink-admin" ]; then echo HAS_ADMIN; else echo NO_ADMIN; fi ;;
      *PROJECT*) echo "34 objects imported automatically"; echo; echo "PROJECT 3 0123456789abcdef0123456789abcdef" ;;
    esac ;;
  *" createsuperuser "*) printf '%s' "\${DJANGO_SUPERUSER_PASSWORD:-}" >"$C/bugsink-admin" ;;
esac`,
  gunicorn: 'exit 0',
  'bugsink-runsnappea': 'exit 0',
};

/** The application's own commands, run by the scripts as the service user. */
const APP_STUBS: Record<string, string> = {
  // pnpm, inside a release directory.
  pnpm: `echo "  (in $PWD)" >>"$L"
case " $* " in
  *" --prod "*) mkdir -p node_modules && touch node_modules/.production ;;
  *" build "*)
    [ -e "$C/build-fails" ] && { echo "vite: the build failed" >&2; exit 1; }
    mkdir -p apps/web/dist/assets && echo '<!doctype html>' >apps/web/dist/index.html ;;
  *" install "*) mkdir -p node_modules/vite && touch node_modules/vite/dev-only ;;
esac`,
  // node, running one of the application's scripts.
  node: `echo "  (in $PWD, HOME=$HOME)" >>"$L"
case " $* " in
  *" --version "*) echo v22.23.3 ;;
  *migrate-cli.ts*) [ -e "$C/migrate-fails" ] && { echo "20261019000000_new.sql failed: boom"; exit 1; }; echo "Applying 20261019000000_new.sql" ;;
  # The migrations the database has applied, as the test arranged them.
  # A release from before the command answers with its usage, and exit 2.
  *" applied-migrations"*)
    [ -e "$C/applied-migrations-unknown" ] && { echo "usage: ..."; exit 2; }
    [ -e "$C/applied-migrations" ] && cat "$C/applied-migrations"; exit 0 ;;
  *" contact-key"*) [ -e "$C/contact-key-differs" ] && { echo "CONTACT_KEY has changed"; exit 1; }; echo "contact key: same" ;;
  *) echo "app: $*" ;;
esac`,
};

export interface Run {
  status: number;
  stdout: string;
  stderr: string;
  /** stdout and stderr, colours removed. */
  out: string;
}

export class Sandbox {
  readonly dir: string;
  /** Stands in for `/`. */
  readonly root: string;
  readonly control: string;
  readonly logFile: string;
  readonly bin: string;
  /** A copy of the repository's deploy/ (paths moved) and .env.example, as a checkout would have. */
  readonly checkout: string;

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'rl-deploy-'));
    this.root = join(this.dir, 'root');
    this.control = join(this.dir, 'control');
    this.logFile = join(this.dir, 'calls.log');
    this.bin = join(this.dir, 'bin');
    this.checkout = join(this.dir, 'checkout');
    for (const d of [this.root, this.control, this.bin, join(this.dir, 'home')]) {
      mkdirSync(d, { recursive: true });
    }
    writeFileSync(this.logFile, '');
    for (const [name, body] of Object.entries(STUBS)) this.stub(this.bin, name, body);
    for (const [name, body] of Object.entries(VENV_STUBS)) {
      this.stub(join(this.dir, 'venv-bin'), name, body);
    }
    this.copyCheckout(this.checkout);
  }

  /** A path inside the pretend machine: at('/srv/reportlog') */
  at(path: string): string {
    return join(this.root, path);
  }

  private stub(dir: string, name: string, body: string) {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, name);
    writeFileSync(
      file,
      `${STUB_HEAD(this.logFile, name)}C=${JSON.stringify(this.control)}; R=${JSON.stringify(this.root)}; L=${JSON.stringify(this.logFile)}\n${body}\n`,
    );
    chmodSync(file, 0o755);
  }

  /** node and pnpm as the server has them, in /usr/local/bin. */
  appCommands() {
    for (const [name, body] of Object.entries(APP_STUBS)) {
      this.stub(this.at('/usr/local/bin'), name, body);
    }
  }

  /** deploy/ with its paths moved, plus .env.example, into `dest`. */
  copyCheckout(dest: string) {
    cpSync(join(REPO, 'deploy'), join(dest, 'deploy'), { recursive: true });
    copyFileSync(join(REPO, '.env.example'), join(dest, '.env.example'));
    for (const f of [
      'deploy.sh',
      'rollback.sh',
      'install.sh',
      'install-bugsink.sh',
      'lib.sh',
      'bin/reportlog',
    ]) {
      const p = join(dest, 'deploy', f);
      writeFileSync(p, rewrite(readFileSync(p, 'utf8'), this.root));
    }
  }

  /** Arrange something for the stand-ins: a control file. */
  set(name: string, content = '') {
    mkdirSync(dirname(join(this.control, name)), { recursive: true });
    writeFileSync(join(this.control, name), content);
  }

  unset(name: string) {
    rmSync(join(this.control, name), { force: true });
  }

  /** The recorded calls, one per line ("name arg arg"), indented lines being a stand-in's notes. */
  calls(): string[] {
    return readFileSync(this.logFile, 'utf8').split('\n').filter(Boolean);
  }

  /** Forget the calls so far. */
  clearCalls() {
    writeFileSync(this.logFile, '');
  }

  /** The position of the first call matching `pattern` after `from`, or -1. */
  index(pattern: RegExp, from = 0): number {
    const calls = this.calls();
    for (let i = from; i < calls.length; i++) if (pattern.test(calls[i] ?? '')) return i;
    return -1;
  }

  /**
   * Run a program with only the stand-ins and the basic system tools on PATH.
   * `input` is what a person would type, one answer per line; without it the
   * program reads end of input at once, as an unattended run would.
   */
  run(program: string, args: string[] = [], opts: { wrapper?: string; input?: string } = {}): Run {
    const env = {
      PATH: `${this.bin}:/usr/bin:/bin`,
      HOME: join(this.dir, 'home'),
      LANG: 'C.UTF-8',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.org',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.org',
    };
    const r = opts.wrapper
      ? spawnSync('bash', ['-c', opts.wrapper, '_', program, ...args], {
          env,
          encoding: 'utf8',
          input: opts.input ?? '',
        })
      : spawnSync(program, args, { env, encoding: 'utf8', input: opts.input ?? '' });
    const stdout = r.stdout;
    const stderr = r.stderr;
    // eslint-disable-next-line no-control-regex
    const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    return { status: r.status ?? -1, stdout, stderr, out: plain(stdout + stderr) };
  }

  read(path: string): string {
    return readFileSync(this.at(path), 'utf8');
  }

  exists(path: string): boolean {
    return existsSync(this.at(path));
  }

  ls(path: string): string[] {
    return existsSync(this.at(path)) ? readdirSync(this.at(path)).sort() : [];
  }

  /** Where a symlink in the pretend machine points, as a name in releases/, or null. */
  release(link: '/srv/reportlog/current' | '/srv/reportlog/previous'): string | null {
    try {
      return (
        execFileSync('readlink', ['-e', this.at(link)], { encoding: 'utf8' })
          .trim()
          .split('/')
          .pop() ?? null
      );
    } catch {
      return null;
    }
  }

  remove() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/**
 * A server as install.sh leaves it, plus an upstream repository to deploy
 * from whose deploy/ is this repository's own (paths moved).
 */
export class Server extends Sandbox {
  readonly upstream: string;

  constructor() {
    super();
    this.upstream = join(this.dir, 'upstream');
    for (const d of [
      '/srv/reportlog/releases',
      '/etc/reportlog',
      '/var/lib/reportlog',
      '/var/backups/reportlog',
      '/etc/systemd/system',
      '/etc/caddy',
      '/run',
    ]) {
      mkdirSync(this.at(d), { recursive: true });
    }
    writeFileSync(
      this.at('/etc/reportlog/reportlog.env'),
      [
        '# Settings',
        'DATABASE_URL=postgresql://reportlog@/reportlog?host=/var/run/postgresql',
        'SITE_ORIGIN=https://reports.example.org',
        'PORT=3123',
        'TRUST_PROXY=1',
        `CONTACT_KEY=${Buffer.alloc(32, 7).toString('base64')}`,
        '',
      ].join('\n'),
    );
    writeFileSync(
      this.at('/etc/reportlog/deploy.env'),
      `REPO_URL=${this.upstream}\nDEPLOY_REF=main\nACME_EMAIL=ops@example.org\n`,
    );
    this.appCommands();
    // The tooling install.sh puts in place.
    const lib = this.at('/usr/local/lib/reportlog');
    mkdirSync(lib, { recursive: true });
    for (const f of ['deploy.sh', 'rollback.sh', 'install.sh', 'lib.sh', 'versions.conf']) {
      copyFileSync(join(this.checkout, 'deploy', f), join(lib, f));
      chmodSync(join(lib, f), f.endsWith('.sh') && f !== 'lib.sh' ? 0o755 : 0o644);
    }
    copyFileSync(join(this.checkout, 'deploy/bin/reportlog'), this.at('/usr/local/bin/reportlog'));
    chmodSync(this.at('/usr/local/bin/reportlog'), 0o755);

    // The upstream repository: the checkout plus the files a deploy runs.
    mkdirSync(this.upstream);
    cpSync(this.checkout, this.upstream, { recursive: true });
    for (const f of ['apps/api/src/db/migrate-cli.ts', 'apps/api/src/jobs/cli.ts']) {
      mkdirSync(dirname(join(this.upstream, f)), { recursive: true });
      writeFileSync(join(this.upstream, f), '// stand-in\n');
    }
    writeFileSync(join(this.upstream, 'package.json'), '{"version":"0.1.0"}\n');
    this.git('init', '-q', '-b', 'main');
  }

  git(...args: string[]): string {
    return execFileSync('git', ['-C', this.upstream, ...args], {
      encoding: 'utf8',
      env: {
        PATH: '/usr/bin:/bin',
        HOME: join(this.dir, 'home'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.org',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.org',
      },
    }).trim();
  }

  /** Commit what is in upstream now; returns the commit. */
  commit(message: string): string {
    this.git('add', '-A');
    this.git('-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message);
    return this.git('rev-parse', 'HEAD');
  }

  /** `sudo reportlog <args>` */
  reportlog(...args: string[]): Run {
    return this.run(this.at('/usr/local/bin/reportlog'), args);
  }

  /** The release directory deployed from `sha`, if any (not a failed one). */
  releaseOf(sha: string): string | undefined {
    return this.ls('/srv/reportlog/releases').find((d) => d.endsWith(`-${sha.slice(0, 12)}`));
  }
}
