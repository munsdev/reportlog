/**
 * Reading what the server would have emailed (it writes each message to
 * e2e/.outbox/ during the browser tests; see playwright.config.ts).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

const OUTBOX = fileURLToPath(new URL('../.outbox/', import.meta.url));
const API = fileURLToPath(new URL('../../../api/', import.meta.url));

interface Message {
  to: string;
  subject: string;
  text: string;
}

function messagesTo(address: string): Message[] {
  if (!existsSync(OUTBOX)) return [];
  return readdirSync(OUTBOX)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(OUTBOX, f), 'utf8')) as Message)
    .filter((m) => m.to === address.toLowerCase());
}

/** The newest message to this address, waiting for it to arrive. */
export async function lastMessageTo(address: string, after = 0): Promise<Message> {
  let found: Message | undefined;
  await expect
    .poll(() => {
      const all = messagesTo(address);
      found = all.length > after ? all.at(-1) : undefined;
      return Boolean(found);
    })
    .toBe(true);
  if (!found) throw new Error(`nothing was emailed to ${address}`);
  return found;
}

export const countTo = (address: string) => messagesTo(address).length;

/** The six-digit code in a message, standing alone. */
export function codeIn(m: Message): string {
  const code = /(?:^|\s)(\d{6})(?=[\s.,]|$)/m.exec(m.text)?.[1];
  if (!code) throw new Error(`no code in "${m.subject}"`);
  return code;
}

export function linkIn(m: Message): string {
  const link = /https?:\/\/\S+/.exec(m.text)?.[0];
  if (!link) throw new Error(`no link in "${m.subject}"`);
  return link;
}

/** Put the identity tables in a known state (apps/api/src/identity/dev-state.ts). */
export function identityState(...args: string[]): void {
  execFileSync('node', ['--env-file-if-exists=../../.env', 'src/identity/dev-state.ts', ...args], {
    cwd: API,
  });
}
