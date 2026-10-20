/**
 * THE RUNBOOK SAYS WHAT THE SERVER'S SETTINGS ARE, and how to check DNS on a
 * machine with nothing installed. `deploy/README.md` is what an operator has
 * open while they set a server up; a setting it never names is one they meet
 * for the first time in a failure.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');
const runbook = read('deploy/README.md');

describe('deploy/README.md', () => {
  it('names every setting .env.example has', () => {
    const keys = new Set(
      [...read('.env.example').matchAll(/^(?:# )?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1] ?? ''),
    );
    expect(keys.size).toBeGreaterThan(50);
    expect([...keys].filter((k) => !new RegExp(`\\b${k}\\b`).test(runbook))).toEqual([]);
  });

  it('says what to do when dig is not installed', () => {
    expect(runbook).toMatch(/dig \+short/);
    expect(runbook).toMatch(/dig: command not found/);
    // A tool every machine has, not another one to install first.
    expect(runbook).toMatch(/getent hosts/);
  });

  it('says whose credential a private clone uses', () => {
    expect(runbook).toMatch(/private repository/i);
    expect(runbook).toMatch(/\*\*It is root's\s+credential\*\*/);
    expect(runbook).toMatch(/`reportlog` user[^.]*never\s+holds it/);
  });
});
