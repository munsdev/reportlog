/**
 * Normalizing one answer against the field that asked for it.
 *
 * WHY THIS IS NOT src/answers.js. That file does the same job for reports,
 * and lists are forbidden from importing it — it imports `reportCore.js`,
 * which is the sealing code, and `npm test` walks the import graph to keep
 * that true. So this is a second, smaller implementation of a similar idea.
 *
 * THE DUPLICATION IS THE PRICE OF THE GUARANTEE, and it is worth stating
 * rather than hiding: sharing the normalizer would mean the intake path
 * could reach the chain, which is exactly the thing the format exists to
 * prevent. The two are allowed to diverge, because they are answering
 * different questions — `answers.js` has to produce bytes that will be
 * hashed and must therefore never change, and nothing here is hashed at
 * all, so this one may be fixed whenever it is wrong.
 *
 * Field type IDS are shared, from src/fieldTypes.js, which is a leaf module
 * and safe to import. One vocabulary, two normalizers.
 */
import { FIELD_TYPE_IDS, LOCATION_TYPE } from '../fieldTypes.js';
import { normalizeLocation } from '../gazetteer.js';
import { normalizeUrl } from './urls.js';

export const MAX_SHORT_TEXT = 200;
export const MAX_LONG_TEXT = 1000;

const TRUEISH = new Set(['true', 'yes', 'on', '1']);
const FALSEISH = new Set(['false', 'no', 'off', '0']);

/**
 * Returns `{ ok: true, value }` or `{ ok: false, reason }`. Never throws:
 * every caller is handling something a stranger typed.
 *
 * An answer that normalizes to nothing comes back as `{ ok: true, value:
 * undefined }`, and the caller OMITS THE KEY rather than writing a null.
 * An aggregate has to tell "never asked" from "asked and skipped", and a
 * null cannot carry that difference.
 */
export function normalizeValue(field, raw) {
  const kind = field.kind;
  if (!FIELD_TYPE_IDS.includes(kind)) return { ok: false, reason: 'unknown-field-kind' };

  const blank = raw === null || raw === undefined
    || (typeof raw === 'string' && raw.trim() === '');
  if (blank) return { ok: true, value: undefined };

  switch (kind) {
    case 'short_text': {
      const v = String(raw).trim();
      if (v.length > MAX_SHORT_TEXT) return { ok: false, reason: 'too-long' };
      return { ok: true, value: v };
    }
    case 'long_text': {
      const v = String(raw).trim();
      // Counted identically on the client, here, and nowhere else — there
      // is no CHECK for it, because the text lives inside a jsonb column.
      if (v.length > MAX_LONG_TEXT) return { ok: false, reason: 'too-long' };
      return { ok: true, value: v };
    }
    case 'email': {
      const v = String(raw).trim().toLowerCase();
      // Deliberately permissive: a shape check, not a claim the address
      // exists. Nothing here sends mail to prove it.
      if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v)) return { ok: false, reason: 'not-an-email' };
      return { ok: true, value: v };
    }
    case 'url': {
      const norm = normalizeUrl(raw);
      if (!norm.ok) return { ok: false, reason: norm.reason };
      // The normalized form is what is stored and what is hashed into
      // url_key, so two spellings of one link answer as one link.
      return { ok: true, value: norm.url, url: norm };
    }
    case 'yes_no': {
      const v = String(raw).trim().toLowerCase();
      if (raw === true || TRUEISH.has(v)) return { ok: true, value: true };
      if (raw === false || FALSEISH.has(v)) return { ok: true, value: false };
      return { ok: false, reason: 'not-a-yes-or-no' };
    }
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { ok: false, reason: 'not-a-number' };
      return { ok: true, value: n };
    }
    case 'date': {
      const v = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, reason: 'not-a-date' };
      if (Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return { ok: false, reason: 'not-a-date' };
      return { ok: true, value: v };
    }
    case 'time': {
      const v = String(raw).trim();
      if (!/^\d{2}:\d{2}$/.test(v)) return { ok: false, reason: 'not-a-time' };
      return { ok: true, value: v };
    }
    case 'datetime': {
      const t = Date.parse(String(raw).trim());
      if (Number.isNaN(t)) return { ok: false, reason: 'not-a-datetime' };
      return { ok: true, value: new Date(t).toISOString() };
    }
    case 'choice_one':
    case 'place': {
      const v = String(raw).trim();
      const options = Array.isArray(field.options?.options) ? field.options.options
        : Array.isArray(field.options) ? field.options : [];
      const allowOther = field.options?.allowOther === true || field.options?.allow_other === true;
      if (options.length && !options.includes(v) && !allowOther) {
        return { ok: false, reason: 'not-an-option' };
      }
      if (!options.length && !allowOther && kind === 'choice_one') {
        // A choice with no options to choose from is a broken form, not a
        // bad answer, and saying so names the right thing.
        return { ok: false, reason: 'field-has-no-options' };
      }
      if (v.length > MAX_SHORT_TEXT) return { ok: false, reason: 'too-long' };
      return { ok: true, value: v };
    }
    case 'choice_many': {
      const list = Array.isArray(raw) ? raw : [raw];
      const options = Array.isArray(field.options?.options) ? field.options.options
        : Array.isArray(field.options) ? field.options : [];
      const allowOther = field.options?.allowOther === true || field.options?.allow_other === true;
      const out = [];
      for (const item of list) {
        const v = String(item).trim();
        if (!v) continue;
        if (options.length && !options.includes(v) && !allowOther) {
          return { ok: false, reason: 'not-an-option' };
        }
        if (!out.includes(v)) out.push(v);
      }
      // Sorted, so two people ticking the same two boxes in a different
      // order produce the same stored answer and the same aggregate group.
      out.sort();
      return { ok: true, value: out.length ? out : undefined };
    }
    case LOCATION_TYPE: {
      /* THE SAME NORMALISER THE LOGBOOK SIDE USES, imported rather than
         copied. `src/gazetteer.js` reads a JSON file and nothing else —
         no db, no reportCore, no sealing code — so it is safe to import
         here in the way `fieldTypes.js` is, and `npm test` walks the
         import graph to keep that true.

         THIS IS NOT THE `answers.js` CASE. values.js duplicates part of
         answers.js because answers.js imports the sealing code and the
         duplication is the price of the guarantee. gazetteer.js imports
         nothing of the kind, so copying it would buy no guarantee and
         cost a second place for the place codes to disagree — and two
         normalisers disagreeing is a map that counts an area the form
         cannot offer. */
      /* It returns the code or null — not an {ok} pair like the rest of
         this file — so the refusal is worded here. `not-a-place` and not
         `not-an-option`: a code outside the question's scope is the same
         failure as a code that names nowhere, and both mean the answer
         cannot be drawn. */
      const code = normalizeLocation(raw, field.options || {});
      if (!code) return { ok: false, reason: 'not-a-place' };
      return { ok: true, value: code };
    }
    default:
      // file and evidence_declaration land here and are refused in
      // fields.js long before an answer could arrive for one.
      return { ok: false, reason: 'kind-not-available-on-a-list' };
  }
}
