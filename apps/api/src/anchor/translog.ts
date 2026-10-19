/**
 * The local checkout of the public transparency log, and getting it out.
 *
 * THE LOG IS NEVER REWRITTEN, not even to correct it. Everything here only
 * adds: a file is written once and never replaced, commits are never amended,
 * and nothing is ever force-pushed. A remote that has moved on without us
 * refuses the push, and that refusal is reported, not overridden.
 *
 * MIRRORS ARE THE POINT. A record that one company holds is a record one
 * company can be compelled to remove, so each configured remote is pushed on
 * its own and one being down never stops the others.
 *
 * ADDRESSES NEVER REACH A LOG LINE. A remote's address can carry a token, so
 * a remote is named by its position and host ("remote 1 (codeberg.org)"), and
 * git's own error text has the address replaced before anybody sees it.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface LogSettings {
  /** The checkout on this server. */
  dir: string;
  /** Git addresses, in order; the first is the one a fresh checkout is cloned from. */
  remotes: readonly string[];
  branch: string;
  /** A private key for ssh remotes, if they use one. */
  sshKey?: string | undefined;
  author: { name: string; email: string };
}

export interface Remote {
  url: string;
  label: string;
}

/** "remote 2 (codeberg.org)": what a log line may say about a remote. */
export function remotes(settings: Pick<LogSettings, 'remotes'>): Remote[] {
  return settings.remotes.map((url, i) => ({
    url,
    label: `remote ${String(i + 1)} (${hostOf(url)})`,
  }));
}

export function hostOf(url: string): string {
  const scp = /^[^@/\s]+@([^:/\s]+):/.exec(url);
  if (scp?.[1]) return scp[1];
  const m = /^[a-z+]+:\/\/(?:[^@/\s]*@)?([^:/\s]+)/i.exec(url);
  return m?.[1] ?? 'a local path';
}

/** Git's words with every address (and anything that looks like a credential) taken out. */
export function scrub(text: string, list: readonly Remote[]): string {
  let s = text;
  for (const r of list) s = s.split(r.url).join(`<${r.label}>`);
  // Belt and braces: a URL git printed in another form (with a trailing
  // slash, say) still loses its user and password.
  s = s.replace(/([a-z+]+:\/\/)[^@/\s]+@/gi, '$1***@');
  return s.trim().split('\n').slice(-3).join(' / ');
}

export class LogError extends Error {
  override name = 'LogError';
}

export class TransparencyLog {
  readonly list: Remote[];
  readonly settings: LogSettings;

  constructor(settings: LogSettings) {
    this.settings = settings;
    this.list = remotes(settings);
  }

  private env(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // A timer has nobody to type a password. A prompt would hang the job.
      GIT_TERMINAL_PROMPT: '0',
    };
    if (this.settings.sshKey) {
      // NOT StrictHostKeyChecking=no: a push that accepts any host can be
      // pointed at another machine. accept-new records the host once and
      // refuses a change after that.
      const known = join(dirname(this.settings.sshKey), 'known_hosts');
      env.GIT_SSH_COMMAND = `ssh -i ${this.settings.sshKey} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${known}`;
    }
    return env;
  }

  async git(args: readonly string[], cwd = this.settings.dir): Promise<string> {
    const { name, email } = this.settings.author;
    try {
      const { stdout } = await run(
        'git',
        [
          '-c',
          `user.name=${name}`,
          '-c',
          `user.email=${email}`,
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd, env: this.env(), timeout: 120_000, maxBuffer: 16 << 20 },
      );
      return stdout;
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message?: string };
      const said =
        `${err.stderr ?? ''}\n${err.stdout ?? ''}`.trim() || (err.message ?? 'git failed');
      throw new LogError(scrub(said, this.list));
    }
  }

  /**
   * A checkout to write into. Cloned from the first remote if there is none
   * yet; started empty if no remote is configured, so the anchor can still be
   * kept here and published once one is.
   */
  async ready(): Promise<{ created: boolean }> {
    const { dir, branch } = this.settings;
    if (existsSync(join(dir, '.git'))) return { created: false };
    await mkdir(dirname(dir), { recursive: true });
    if (!this.list.length) {
      await mkdir(dir, { recursive: true });
      await this.git(['init', '--quiet', '--initial-branch', branch]);
      return { created: true };
    }
    // From whichever mirror answers first: one host being down must not stop
    // the first anchor any more than it stops a push.
    const why: string[] = [];
    for (const r of this.list) {
      try {
        await this.git(['clone', '--quiet', '--branch', branch, r.url, dir], dirname(dir));
        return { created: true };
      } catch (e) {
        why.push(`${r.label}: ${(e as Error).message}`);
      }
    }
    throw new LogError(`No remote could be cloned. ${why.join(' ')}`);
  }

  /**
   * Catch up with the first remote before writing, fast-forward only. Not
   * fatal: the remote may be down, and the push afterwards says whether the
   * day reached anyone.
   */
  async catchUp(): Promise<string | null> {
    const first = this.list[0];
    if (!first) return null;
    try {
      await this.git(['pull', '--quiet', '--ff-only', first.url, this.settings.branch]);
      return null;
    } catch (e) {
      return `Could not catch up with ${first.label}: ${(e as Error).message}`;
    }
  }

  path(rel: string): string {
    return join(this.settings.dir, rel);
  }

  has(rel: string): boolean {
    return existsSync(this.path(rel));
  }

  async read(rel: string): Promise<string> {
    return readFile(this.path(rel), 'utf8');
  }

  /**
   * Write a file that does not exist yet. A file that does exist is left
   * exactly as it is: what was published stays published.
   */
  async writeOnce(rel: string, content: string): Promise<boolean> {
    if (this.has(rel)) return false;
    await mkdir(dirname(this.path(rel)), { recursive: true });
    await writeFile(this.path(rel), content, { flag: 'wx' });
    return true;
  }

  /** The newest file in a folder by its date name, or null. */
  async newest(folder: string, before?: string): Promise<string | null> {
    if (!this.has(folder)) return null;
    const names = (await readdir(this.path(folder)))
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
      .filter((n) => before === undefined || n.slice(0, 10) < before)
      .sort();
    const last = names.at(-1);
    return last ? `${folder}/${last}` : null;
  }

  /** Commit what is new. False when there was nothing to commit. */
  async commit(files: readonly string[], message: string): Promise<boolean> {
    if (files.length) await this.git(['add', '--', ...files]);
    const staged = await this.git(['diff', '--cached', '--name-only']);
    if (!staged.trim()) return false;
    await this.git(['commit', '--quiet', '-m', message]);
    return true;
  }

  /**
   * Push to every remote, each on its own. Run whether or not anything was
   * committed today: a day whose commit landed and whose push did not must be
   * retried by the next run, not skipped as "nothing to commit".
   */
  async pushAll(): Promise<{ reached: string[]; failed: { label: string; why: string }[] }> {
    const reached: string[] = [];
    const failed: { label: string; why: string }[] = [];
    for (const r of this.list) {
      try {
        await this.git(['push', '--quiet', r.url, `HEAD:refs/heads/${this.settings.branch}`]);
        reached.push(r.label);
      } catch (e) {
        failed.push({ label: r.label, why: (e as Error).message });
      }
    }
    return { reached, failed };
  }
}
