/**
 * Asking a person a series of questions at a terminal.
 *
 * Extracted from scripts/set-curtain-password.js when the configure script
 * needed the same thing. Two implementations of "read a secret without
 * echoing it" is one more than anybody can keep correct.
 *
 * WHY THIS DOES NOT USE `readline`. It did, and it worked for exactly one
 * question. A `readline.Interface` over `process.stdin` consumes the stream,
 * so closing one after reading a line leaves the next interface with nothing
 * — the second question of a piped install answered `null` and the script
 * hung on an unsettled await. One interface reused across questions runs
 * into the other half of the problem: hidden input needs raw mode, and
 * readline owns the terminal in a way that fights it.
 *
 * So: ONE listener on stdin for the life of the process, a line buffer, and
 * echo under our own control. It behaves identically whether the answers are
 * typed or piped, which is the property that matters — these scripts are
 * driven both ways.
 */
import { applyKeys } from './lineEdit.js';

const CTRL_C = '\x03';
const CTRL_D = '\x04';

let installed = false;
// THE LINE AS KEYSTROKES, and what they mean as text. Arrow keys, Home, End,
// Delete and Backspace edit the line the way the screen shows it — see
// src/lineEdit.js for the email whose sender name was full of "[D".
let raw = '';
let line = { text: '', cursor: 0 };
let queued = [];           // lines that arrived before anything asked for them
let waiter = null;         // the question currently outstanding
let echoing = false;       // does the outstanding question want its answer shown
let asking = '';           // the question text, so a redraw can repeat it
let ended = false;

/** Is anybody actually there to answer? */
export const interactive = () => Boolean(process.stdin.isTTY);

const shouldEcho = () => interactive() && echoing;

function deliver(answer) {
  if (waiter) {
    const { resolve } = waiter;
    waiter = null;
    resolve(answer);
  } else {
    queued.push(answer);
  }
}

/* Draw the line again from the start, with the cursor where the edit left
   it. Cheaper to reason about than echoing a character at a time, and the
   only way to show a character inserted in the middle. */
function redraw() {
  if (!shouldEcho()) return;
  const back = line.text.length - line.cursor;
  process.stdout.write(`\r${asking}${line.text}\x1b[K${back > 0 ? `\x1b[${back}D` : ''}`);
}

function onData(chunk) {
  let pending = '';
  const flush = () => {
    if (!pending) return;
    line = applyKeys(pending, line);
    raw += pending;
    pending = '';
    redraw();
  };
  for (const ch of String(chunk)) {
    if (ch === CTRL_C) { closePrompt(); process.stdout.write('\n'); process.exit(130); }
    if (ch === CTRL_D && !line.text && !pending) { ended = true; deliver(null); continue; }
    if (ch === '\r' || ch === '\n') {
      flush();
      const answer = line.text;
      raw = '';
      line = { text: '', cursor: 0 };
      if (interactive()) process.stdout.write('\n');
      deliver(answer);
      continue;
    }
    pending += ch;
  }
  flush();
}

function install() {
  if (installed) return;
  installed = true;
  // Raw mode only on a terminal: it is what lets a secret go unechoed, and
  // there is nothing to echo to on a pipe.
  if (interactive()) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  process.stdin.on('data', onData);
  process.stdin.on('end', () => {
    ended = true;
    // A piped file whose last line has no newline still has an answer on it.
    if (raw) { const answer = line.text; raw = ''; line = { text: '', cursor: 0 }; deliver(answer); }
    else deliver(null);
  });
}

/** Let the process exit. Without this, a resumed stdin keeps it alive. */
export function closePrompt() {
  if (!installed) return;
  installed = false;
  process.stdin.removeListener('data', onData);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
}

function readLine({ echo, question = '' }) {
  install();
  if (queued.length) return Promise.resolve(queued.shift());
  if (ended) return Promise.resolve(null);
  echoing = echo;
  asking = question;
  return new Promise((resolve) => { waiter = { resolve }; });
}

/**
 * A visible answer, with an optional default.
 *
 * Piped input answers one question per line, in order, which is what makes
 * these scripts drivable from configuration management. An empty line takes
 * the default.
 */
export async function ask(question, { fallback = '' } = {}) {
  const shown = fallback ? `${question} [${fallback}]: ` : `${question}: `;
  process.stdout.write(shown);
  const answer = await readLine({ echo: true, question: shown });
  return String(answer ?? '').trim() || fallback;
}

/** A secret. Never echoed, on a terminal or in a log. */
export async function askHidden(question) {
  process.stdout.write(`${question}: `);
  const answer = await readLine({ echo: false });
  if (!interactive() && answer !== null) process.stdout.write('\n');
  return answer === null ? '' : String(answer);
}

/**
 * Ask until the answer passes, or give up.
 *
 * `validate` returns `{ ok, value }` or `{ ok: false, error }` — the same
 * shape the validators in src/installConfig.js return, so they drop
 * straight in.
 */
export async function askUntilValid(question, validate, opts = {}) {
  const { fallback = '', hidden = false, tries = 3 } = opts;
  for (let i = 0; i < tries; i += 1) {
    const raw = hidden ? await askHidden(question) : await ask(question, { fallback });
    const result = validate(raw);
    if (result.ok) return result.value;
    console.log(`  ${result.error}`);
    // A pipe cannot do better on a second attempt, and looping would read
    // the NEXT answer as a retry of this question and misalign every
    // remaining one — which is worse than failing here.
    if (!interactive()) return null;
  }
  return null;
}

/** A yes/no, defaulting to no unless told otherwise. */
export async function confirm(question, { fallback = false } = {}) {
  const answer = await ask(`${question} (y/n)`, { fallback: fallback ? 'y' : 'n' });
  return /^y/i.test(answer);
}
