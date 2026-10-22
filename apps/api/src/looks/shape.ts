/**
 * What check() leaves to its caller: the shape of look.json beyond the
 * values that become CSS.
 *
 * check() (packages/contracts/src/look/pack.ts) holds every value that
 * reaches a stylesheet to a type and a range. It does not ask what else a
 * look.json holds, or whether a label is text, because the built-in pack is
 * written by us. An uploaded one is not, and what it holds is stored and
 * sent back out: a `dark` that is "yes" rather than true would make every
 * page's look fail its own schema, and a label that is a number would break
 * the list of packs. So an installed pack is held to exactly the fields the
 * format names (docs/design/looks/README.md, section 03), each the type it
 * should be. That is also the format's promise kept: there is no field a URL
 * could go in, because there is no field the site does not read.
 */

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => v !== null && typeof v === 'object' && !Array.isArray(v);

const FIELDS = {
  pack: ['format', 'id', 'label', 'version', 'author', 'fonts', 'palettes', 'themes', 'looks'],
  font: ['family', 'licence', 'files'],
  file: ['file', 'weight', 'style', 'stretch'],
  palette: ['id', 'label', 'description', 'dark', 'colors'],
  theme: [
    'id',
    'label',
    'description',
    'type',
    'shape',
    'pageMax',
    'panelHead',
    'texture',
    'width',
    'columns',
    'scale',
    'surface',
  ],
  type: ['heading', 'body', 'label', 'mono', 'h1'],
  face: ['family', 'stretch', 'weight', 'case', 'tracking', 'size'],
  h1: ['min', 'max'],
  shape: ['radius', 'radiusSmall', 'border', 'shadow', 'press'],
  look: ['id', 'label', 'palette', 'theme', 'default'],
} as const;

const LABEL = 60;
const DESCRIPTION = 300;
const AUTHOR = 100;

const text = (v: unknown, max: number, optional = false) =>
  (optional && v === undefined) ||
  (typeof v === 'string' && v.trim().length > 0 && v.length <= max);

const named = (v: unknown) => (typeof v === 'string' ? v.slice(0, 40) : '?');

/** Every way look.json is not the shape the format names, in words. */
export function shapeProblems(input: unknown): string[] {
  const out: string[] = [];
  if (!isBag(input)) return ['look.json must be one object, { … }.'];

  const extra = (where: string, bag: Bag, allowed: readonly string[]) => {
    const unknown = Object.keys(bag).filter((k) => !allowed.includes(k));
    if (unknown.length)
      out.push(
        `${where} has ${unknown.length === 1 ? 'a field' : 'fields'} this site does not read: ${unknown
          .map((k) => `"${k.slice(0, 40)}"`)
          .join(', ')}.`,
      );
  };
  const items = (key: string): Bag[] => {
    const v = input[key];
    if (v === undefined) return [];
    if (!Array.isArray(v) || !v.every(isBag)) {
      out.push(`In look.json, "${key}" must be a list of { … }.`);
      return [];
    }
    return v;
  };

  extra('look.json', input, FIELDS.pack);
  if (input.label !== undefined && !text(input.label, LABEL))
    out.push(`The pack’s label must be text, up to ${String(LABEL)} characters.`);
  if (!text(input.author, AUTHOR, true))
    out.push(`The author must be text, up to ${String(AUTHOR)} characters.`);

  for (const f of items('fonts')) {
    const where = `The font "${named(f.family)}"`;
    extra(where, f, FIELDS.font);
    if (f.licence !== undefined && !text(f.licence, AUTHOR))
      out.push(`${where}: its licence must be text, up to ${String(AUTHOR)} characters.`);
    if (!Array.isArray(f.files) || !f.files.every(isBag))
      out.push(`${where}: "files" must be a list of { … }.`);
    else
      for (const file of f.files) extra(`The font file "${named(file.file)}"`, file, FIELDS.file);
  }

  const words = (where: string, item: Bag) => {
    if (!text(item.label, LABEL))
      out.push(`${where} needs a label: text, up to ${String(LABEL)} characters.`);
    if (!text(item.description, DESCRIPTION))
      out.push(`${where} needs a description: text, up to ${String(DESCRIPTION)} characters.`);
  };

  for (const p of items('palettes')) {
    const where = `Palette "${named(p.id)}"`;
    extra(where, p, FIELDS.palette);
    words(where, p);
    if (typeof p.dark !== 'boolean') out.push(`${where} must say dark as true or false.`);
  }

  for (const t of items('themes')) {
    const where = `Theme "${named(t.id)}"`;
    extra(where, t, FIELDS.theme);
    words(where, t);
    if (isBag(t.type)) {
      extra(`${where} type`, t.type, FIELDS.type);
      for (const slot of ['heading', 'body', 'label', 'mono'] as const) {
        const face = t.type[slot];
        if (isBag(face)) extra(`${where} ${slot}`, face, FIELDS.face);
      }
      if (isBag(t.type.h1)) extra(`${where} h1`, t.type.h1, FIELDS.h1);
    }
    if (isBag(t.shape)) extra(`${where} shape`, t.shape, FIELDS.shape);
  }

  for (const l of items('looks')) {
    const where = `The look "${named(l.id)}"`;
    extra(where, l, FIELDS.look);
    if (!text(l.label, LABEL))
      out.push(`${where} needs a label: text, up to ${String(LABEL)} characters.`);
  }
  return out;
}
