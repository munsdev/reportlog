/**
 * The test double: a sender that keeps every message instead of sending it.
 *
 * In a unit or database test, build one and read `outbox`. For a browser
 * test, the server runs in another process, so also give it a directory
 * (EMAIL_CAPTURE_DIR): every message is written there as one JSON file, and
 * the test reads the newest file for the address it used and follows the
 * link inside. A path that only runs when somebody clicks a link in an email
 * is the path nothing reaches by accident, so this is how it gets reached.
 *
 *   const mail = createCaptureSender();
 *   ...do the thing that sends...
 *   const link = linkIn(mail.lastTo('reporter@example.org'));
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmailMessage, EmailSender, SendResult } from './types.ts';
import { assertWellFormed, isSendableAddress } from './types.ts';

export interface CapturedEmail extends EmailMessage {
  sentAt: string;
}

export interface CaptureSender extends EmailSender {
  readonly transport: 'capture';
  /** Every message accepted, oldest first. */
  readonly outbox: readonly CapturedEmail[];
  /** The newest message to this address, or undefined. */
  lastTo(address: string): CapturedEmail | undefined;
  /** Make the next send fail as a provider would, to test what the caller does then. */
  failNext(reason: 'rejected' | 'unreachable'): void;
  clear(): void;
}

export function createCaptureSender(options: { dir?: string } = {}): CaptureSender {
  const outbox: CapturedEmail[] = [];
  let failure: 'rejected' | 'unreachable' | undefined;
  let n = 0;
  if (options.dir) mkdirSync(options.dir, { recursive: true });

  return {
    transport: 'capture',
    outbox,
    send(message: EmailMessage): Promise<SendResult> {
      assertWellFormed(message);
      if (!isSendableAddress(message.to)) {
        return Promise.resolve({
          sent: false,
          transport: 'capture',
          reason: 'invalid',
          detail: 'The recipient address is not one a provider would accept.',
        });
      }
      if (failure) {
        const reason = failure;
        failure = undefined;
        return Promise.resolve({
          sent: false,
          transport: 'capture',
          reason,
          detail: `Captured send failed on purpose (${reason}).`,
        });
      }
      const captured: CapturedEmail = { ...message, sentAt: new Date().toISOString() };
      outbox.push(captured);
      if (options.dir) {
        n += 1;
        // Sortable by name: time first, then a counter for the same millisecond.
        const name = `${captured.sentAt.replace(/[:.]/g, '-')}-${String(process.pid)}-${String(n).padStart(6, '0')}.json`;
        writeFileSync(join(options.dir, name), JSON.stringify(captured, null, 2));
      }
      return Promise.resolve({
        sent: true,
        transport: 'capture',
        id: `capture-${String(outbox.length)}`,
      });
    },
    lastTo(address: string) {
      return outbox.findLast((m) => m.to === address);
    },
    failNext(reason) {
      failure = reason;
    },
    clear() {
      outbox.length = 0;
    },
  };
}

/** The newest message to `address` in a capture directory: what a browser test reads. */
export function readCaptured(dir: string, address: string): CapturedEmail | undefined {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch {
    return undefined;
  }
  for (const name of names.reverse()) {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    if (isCaptured(parsed) && parsed.to === address) return parsed;
  }
  return undefined;
}

/** The first http(s) link in a message's plain-text body. */
export function linkIn(message: EmailMessage | undefined): string | undefined {
  return message?.text.match(/https?:\/\/\S+/)?.[0];
}

function isCaptured(v: unknown): v is CapturedEmail {
  return (
    typeof v === 'object' &&
    v !== null &&
    'to' in v &&
    typeof v.to === 'string' &&
    'text' in v &&
    typeof v.text === 'string'
  );
}
