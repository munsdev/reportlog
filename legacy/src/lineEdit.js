/**
 * What a line of typed keystrokes MEANS, as text.
 *
 * WHY THIS EXISTS. The install prompt read a terminal in raw mode and kept
 * every byte it was given. Pressing the left arrow to fix a typo sends
 * ESC [ D; the prompt echoed it, the terminal obligingly moved the cursor,
 * and the person saw their edit happen — while the value written to .env
 * was "Test Log 2\x1b[D\x1b[D…Log 2". It surfaced as the sender name of
 * every email from a test box: "Test Log 2 [D [D [D [D [ [ [3~ [3~ …".
 *
 * So the prompt now edits a line the way the screen shows it, and the same
 * function cleans a name that was saved before the fix, by replaying it:
 * what was on screen is what the person meant.
 *
 * Pure, no I/O, so `npm test` can reach it.
 */

const ESC = '\x1b';

/**
 * Replay keystrokes into text. Returns { text, cursor, edited } — `edited`
 * is true when anything other than plain characters was in the input, which
 * is how a caller tells a cleaned value from one that needed no cleaning.
 */
export function applyKeys(input, start = { text: '', cursor: 0 }) {
  const s = String(input ?? '');
  let text = start.text;
  let cursor = start.cursor;
  let edited = false;
  const insert = (ch) => { text = text.slice(0, cursor) + ch + text.slice(cursor); cursor += ch.length; };

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === ESC) {
      edited = true;
      const next = s[i + 1];
      if (next === '[' || next === 'O') {
        // CSI or SS3: parameters, then one final byte in @–~.
        let j = i + 2;
        while (j < s.length && /[0-9;?]/.test(s[j])) j += 1;
        const params = s.slice(i + 2, j);
        const final = s[j];
        i = j;
        if (final === 'D') cursor = Math.max(0, cursor - 1);
        else if (final === 'C') cursor = Math.min(text.length, cursor + 1);
        else if (final === 'H' || (final === '~' && (params === '1' || params === '7'))) cursor = 0;
        else if (final === 'F' || (final === '~' && (params === '4' || params === '8'))) cursor = text.length;
        else if (final === '~' && params === '3') text = text.slice(0, cursor) + text.slice(cursor + 1);
        // Up, down, function keys and the rest: nothing on one line.
        continue;
      }
      /* ESC FOLLOWED BY ESC IS NOT "ESC PLUS ONE CHARACTER", and treating it
         as one was a real bug. The branch below drops a two-byte
         Alt-something by skipping the next byte — but when that next byte is
         itself ESC, skipping it threw away the introducer of a sequence that
         had only just begun, so the `[2~` after it was inserted as LITERAL
         TEXT. Pressing Escape and then Insert produced exactly that, and the
         result was a name reading "Test L[2~og 2" that no amount of
         re-cleaning could repair, because by then the ESC bytes were gone.
         Found in a test box's ALERT_FROM_NAME. So: leave a second ESC for the
         loop to meet as a fresh ESC. */
      if (next !== undefined && next !== ESC) i += 1;
      continue;
    }
    if (ch === '\x7f' || ch === '\b') {
      edited = true;
      if (cursor > 0) { text = text.slice(0, cursor - 1) + text.slice(cursor); cursor -= 1; }
      continue;
    }
    if (ch === '\x01') { edited = true; cursor = 0; continue; }            // Ctrl-A
    if (ch === '\x05') { edited = true; cursor = text.length; continue; }  // Ctrl-E
    if (ch === '\x15') { edited = true; text = text.slice(cursor); cursor = 0; continue; } // Ctrl-U
    // Any other control character means nothing in a name or an address.
    if (ch < ' ') { edited = true; continue; }
    insert(ch);
  }
  return { text, cursor, edited };
}

/** The text a stored value meant. Plain values come back unchanged. */
export function cleanTyped(value) {
  return applyKeys(value).text;
}

/** Whether a stored value carries keystrokes rather than text. */
export function hasKeystrokes(value) {
  return /[\x00-\x1f\x7f]/.test(String(value ?? ''));
}

/**
 * Does CLEANED text still look like it has the wreckage of a keystroke in it?
 *
 * WHY A CALLER NEEDS THIS. `cleanTyped` replays keystrokes, and that only
 * works while the keystrokes are still keystrokes. Once the ESC bytes are
 * gone — stripped by an editor, a copy-paste, or the double-ESC bug above
 * before it was fixed — what is left is ordinary text that happens to read
 * as `[2~` or `[D`, and nothing can recover what was meant from it.
 *
 * THE REASON THIS MATTERS IS AN APOLOGY. `npm run doctor` found such a value
 * on a test box, cleaned it, and then printed
 *
 *     edit .env and set ALERT_FROM_NAME=Test L[2og 2
 *
 * which is the BROKEN value offered as the fix. Advice that confidently
 * tells somebody to write the thing that is already wrong is worse than no
 * advice: they will paste it. So a caller asks this first, and where it is
 * true, says what it reads as and asks for the name that was meant instead
 * of pretending to know.
 */
export function looksUnclean(text) {
  /* A CSI body with its ESC missing: `[` followed by digits. Deliberately
     loose — this decides whether to TRUST a guess, so a false positive
     costs a vaguer sentence and a false negative costs somebody pasting
     rubbish into .env.
     IT COSTS NOTHING IN PRACTICE, because a caller reaches this only for a
     value that ALREADY failed `hasKeystrokes` — so a perfectly good name
     like "Log [2] draft", which this would flag, never gets here: it has no
     control characters in it and is never a candidate for cleaning. */
  return /\[[0-9;]/.test(String(text ?? ''));
}
