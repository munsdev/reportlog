/**
 * What a NEW migration may do, as code (the plan's section 4, layer 1).
 *
 * A migration written for the free-text and redesign work only adds. It may
 * CREATE a table, index, type, function or trigger, and it may ALTER TABLE ...
 * ADD COLUMN when the column is nullable or has a constant default (so the
 * rows already there are not rewritten with something computed). Everything
 * else is refused here: INSERT, UPDATE, DELETE, DROP, TRUNCATE, RENAME, ALTER
 * COLUMN, ALTER TYPE, a DO block, a constraint added to a table that already
 * holds rows, CREATE OR REPLACE (it would change a function the old code
 * relies on).
 *
 * PARSED, NOT GREPPED. A function body is a string to the statement it sits
 * in: a trigger function that says UPDATE is a definition, not an update. So
 * the text is first cut into statements by a small tokenizer that knows line
 * and block comments (nested, as Postgres has them), 'strings' and E'strings',
 * "identifiers" and $tag$ dollar quoting. Then each statement is judged by
 * what it starts with, and an ALTER TABLE by each of its comma-separated
 * clauses.
 *
 * Pure: no database, no files. test/unit/migration-guard.test.ts feeds it.
 */

export interface Statement {
  /** The statement with comments removed and literals left as written. */
  text: string;
  /** The same, with every literal and quoted identifier blanked, for scanning keywords. */
  masked: string;
}

/** A literal's shape with its contents hidden: same length, so offsets agree. */
function blank(lit: string): string {
  return lit.length <= 2
    ? lit
    : `${lit[0] ?? ''}${'x'.repeat(lit.length - 2)}${lit[lit.length - 1] ?? ''}`;
}

/** Cut SQL into statements at top-level semicolons. */
export function splitStatements(sql: string): Statement[] {
  const out: Statement[] = [];
  let text = '';
  let masked = '';
  const push = () => {
    if (masked.trim()) out.push({ text: text.trim(), masked: masked.trim() });
    text = '';
    masked = '';
  };
  const both = (s: string, blank?: string) => {
    text += s;
    masked += blank ?? s;
  };
  let i = 0;
  while (i < sql.length) {
    const c = sql[i] ?? '';
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      both(' ');
      continue;
    }
    if (two === '/*') {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql.startsWith('/*', j)) {
          depth += 1;
          j += 2;
        } else if (sql.startsWith('*/', j)) {
          depth -= 1;
          j += 2;
        } else j += 1;
      }
      i = j;
      both(' ');
      continue;
    }
    if (c === "'" || c === '"') {
      // E'...' lets a backslash escape the quote; a plain string does not.
      const escapes = c === "'" && /[eE]$/.test(text) && !/\w[eE]$/.test(text);
      let j = i + 1;
      while (j < sql.length) {
        if (escapes && sql[j] === '\\') j += 2;
        else if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) break;
        else j += 1;
      }
      const lit = sql.slice(i, j + 1);
      both(lit, blank(lit));
      i = j + 1;
      continue;
    }
    if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const end = close === -1 ? sql.length : close + tag[0].length;
        both(sql.slice(i, end), blank(sql.slice(i, end)));
        i = end;
        continue;
      }
    }
    if (c === ';') {
      push();
      i += 1;
      continue;
    }
    both(c);
    i += 1;
  }
  push();
  return out;
}

/** Split on commas that are not inside parentheses or brackets. `masked` and `text` line up. */
export function topLevelParts(statement: Statement): { text: string; masked: string }[] {
  const parts: { text: string; masked: string }[] = [];
  const { text, masked } = statement;
  let depth = 0;
  let from = 0;
  for (let i = 0; i < masked.length; i += 1) {
    const m = masked[i];
    if (m === '(' || m === '[') depth += 1;
    else if (m === ')' || m === ']') depth -= 1;
    else if (m === ',' && depth === 0) {
      parts.push({ text: text.slice(from, i).trim(), masked: masked.slice(from, i).trim() });
      from = i + 1;
    }
  }
  parts.push({ text: text.slice(from).trim(), masked: masked.slice(from).trim() });
  return parts;
}

/**
 * A default that is the same for every row and is not computed: a number, a
 * string, true, false, null, optionally cast, or an empty array/object spelt
 * as a string. now(), gen_random_uuid() and nextval() are not constant.
 */
const CONSTANT_DEFAULT =
  /^(?:[-+]?\d+(?:\.\d+)?|'(?:[^']|'')*'|true|false|null)(?:\s*::\s*[A-Za-z_][\w ]*(?:\[\])?)?$/i;

export function isConstantDefault(expr: string): boolean {
  return CONSTANT_DEFAULT.test(
    expr
      .trim()
      .replace(/^\((.*)\)$/s, '$1')
      .trim(),
  );
}

const CREATABLE =
  /^CREATE\s+(?:UNIQUE\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?(TABLE|INDEX|TYPE|FUNCTION|TRIGGER|SEQUENCE)\b/i;

/** Why a statement is not allowed, or null when it is. */
export function judgeStatement(s: Statement): string | null {
  const head = s.masked.replace(/\s+/g, ' ').trim();
  const word = /^[A-Za-z]+/.exec(head)?.[0]?.toUpperCase() ?? '';
  const brief = head.length > 70 ? `${head.slice(0, 70)}...` : head;

  if (word === 'CREATE') {
    if (/^CREATE\s+OR\s+REPLACE\b/i.test(head))
      return `CREATE OR REPLACE changes something that exists: ${brief}`;
    const m = CREATABLE.exec(head);
    if (!m)
      return `only CREATE TABLE, INDEX, TYPE, FUNCTION, TRIGGER or SEQUENCE is allowed: ${brief}`;
    // A trigger or an index creates something; neither changes what is stored.
    return null;
  }
  if (word === 'COMMENT') return null; // documentation on an object; changes no data
  if (word === 'ALTER') return judgeAlter(s);
  if (word === 'BEGIN' || word === 'COMMIT') return null;
  return `${word || 'this statement'} is not allowed in a new migration: ${brief}`;
}

function judgeAlter(s: Statement): string | null {
  const m = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?\S+\s+/i.exec(s.masked);
  if (!m)
    return `only ALTER TABLE ... ADD COLUMN is allowed: ${s.masked.replace(/\s+/g, ' ').slice(0, 70)}`;
  const afterTable = { text: s.text.slice(m[0].length), masked: s.masked.slice(m[0].length) };
  const clauses = topLevelParts({ text: afterTable.text, masked: afterTable.masked });
  const problems: string[] = [];
  for (const clause of clauses) {
    const c = clause.masked.replace(/\s+/g, ' ').trim();
    const add = /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("?\w+"?)\s+(.*)$/is.exec(c);
    if (
      !add ||
      /^(?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)\b/i.test(c.replace(/^ADD\s+/i, ''))
    ) {
      problems.push(`${c.slice(0, 60)} (only ADD COLUMN is allowed on an existing table)`);
      continue;
    }
    const definition = add[2] ?? '';
    const notNull = /\bNOT\s+NULL\b/i.test(definition);
    const generated = /\bGENERATED\b/i.test(definition);
    if (generated) {
      problems.push(`${c.slice(0, 60)} (a generated column is computed for every row)`);
      continue;
    }
    if (notNull) {
      // Position of DEFAULT in the original text, so a string default is read whole.
      const orig = clause.text.replace(/\s+/g, ' ');
      const def =
        /\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|NULL|CHECK|REFERENCES|UNIQUE|PRIMARY|CONSTRAINT|GENERATED|COLLATE)\b|$)/i.exec(
          orig,
        );
      if (!def || !isConstantDefault(def[1] ?? '')) {
        problems.push(`${c.slice(0, 60)} (NOT NULL needs a constant DEFAULT)`);
      }
    } else {
      // Nullable: any DEFAULT must still be constant, or existing rows are rewritten with it.
      const orig = clause.text.replace(/\s+/g, ' ');
      const def =
        /\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|NULL|CHECK|REFERENCES|UNIQUE|PRIMARY|CONSTRAINT|GENERATED|COLLATE)\b|$)/i.exec(
          orig,
        );
      if (def && !isConstantDefault(def[1] ?? '')) {
        problems.push(`${c.slice(0, 60)} (DEFAULT must be a constant)`);
      }
    }
  }
  return problems.length ? problems.join('; ') : null;
}

/**
 * Every reason a migration's text is not additive. Empty means it is.
 *
 * ONE ALLOWANCE BEYOND THE BRIEF'S LIST: INSERT into a table the same file
 * created. The singleton settings row (`INSERT INTO new_settings (id) VALUES
 * (true)`) is how every settings table here starts, and it touches no row
 * that existed before the migration ran.
 */
export function judgeMigration(sql: string): string[] {
  const reasons: string[] = [];
  const created = new Set<string>();
  for (const s of splitStatements(sql)) {
    const flat = s.masked.replace(/\s+/g, ' ');
    const made =
      /^CREATE (?:(?:TEMP|TEMPORARY|UNLOGGED) )?TABLE (?:IF NOT EXISTS )?("?[\w.]+"?)/i.exec(flat);
    if (made?.[1]) created.add(made[1].toLowerCase());
    const into = /^INSERT INTO ("?[\w.]+"?)/i.exec(flat);
    if (into?.[1] && created.has(into[1].toLowerCase())) continue;
    const why = judgeStatement(s);
    if (why) reasons.push(why);
  }
  return reasons;
}
