/**
 * Sending email, behind the smallest interface that will do.
 *
 * Everything that emails somebody (a sign-in code, an invitation, a report's
 * confirmation link) takes a `Mailer` and calls `send`. Nothing knows which
 * provider is behind it. The operations workstream wires the real one; until
 * then a deployment has one of the two below.
 *
 * Plain text only. A message here is a code or a link and a sentence or two
 * around it, and plain text cannot carry somebody's input as markup.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

/** The test double: keeps every message, in order, for a test to read. */
export interface CapturingMailer extends Mailer {
  readonly messages: EmailMessage[];
  /** The newest message to this address, or undefined. */
  lastTo(address: string): EmailMessage | undefined;
}

export function capturingMailer(): CapturingMailer {
  const messages: EmailMessage[] = [];
  return {
    messages,
    send(message) {
      messages.push(message);
      return Promise.resolve();
    },
    lastTo(address) {
      return messages.findLast((m) => m.to === address.trim().toLowerCase());
    },
  };
}

/**
 * Writes each message as a JSON file in a directory. For the browser tests,
 * which run the server as a separate process and need to read the code or
 * follow the link a person would have been sent. Never for a deployment.
 */
export function outboxMailer(dir: string): Mailer {
  let n = 0;
  return {
    send(message) {
      n += 1;
      // Each time, since a test run may empty the directory under a running server.
      mkdirSync(dir, { recursive: true });
      const name = `${String(Date.now())}-${String(process.pid)}-${String(n).padStart(4, '0')}.json`;
      writeFileSync(join(dir, name), JSON.stringify(message));
      return Promise.resolve();
    },
  };
}

/**
 * No provider configured: the message goes to standard error, loudly.
 *
 * The same fallback the old application had, for the same reason: a fresh
 * install with no mail set up must still be able to sign its operator in,
 * and the operator is the one person reading the server's output. Not
 * through the request logger, which never carries a code or a link.
 */
export function stderrMailer(
  write: (line: string) => void = (l) => process.stderr.write(l),
): Mailer {
  return {
    send(message) {
      write(
        `\n[email] No email provider is configured, so this was not sent.\n` +
          `[email] To: ${message.to}\n[email] Subject: ${message.subject}\n${message.text}\n\n`,
      );
      return Promise.resolve();
    },
  };
}
