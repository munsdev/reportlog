/**
 * Writing zips for the look pack tests: honest ones from a fixture folder,
 * and dishonest ones, each entry able to lie about its name, size, kind or
 * checksum, so the reader's refusals can be tried one at a time.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipItem {
  name: string;
  data?: Uint8Array | string;
  /** 0 stored, 8 deflate (the default). */
  method?: number;
  /** A Unix mode for the top half of the external attributes (0o120777 is a link). */
  mode?: number;
  /** Override what the central directory says. */
  size?: number;
  crc?: number;
  flags?: number;
  /** A different name in the local header than in the central directory. */
  localName?: string;
}

export function zip(items: readonly ZipItem[], opts: { comment?: string } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const item of items) {
    const raw = Buffer.from(item.data ?? '');
    const method = item.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(item.name, 'latin1');
    const localName = Buffer.from(item.localName ?? item.name, 'latin1');
    const crc = item.crc ?? crc32(raw);
    const size = item.size ?? raw.length;
    const flags = item.flags ?? 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(localName.length, 26);
    locals.push(local, localName, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    const mode = item.mode ?? (item.name.endsWith('/') ? 0o040755 : 0o100644);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + localName.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const comment = Buffer.from(opts.comment ?? '');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, cd, end, comment]);
}

/** Every file under a folder, named as a zip names them (forward slashes). */
export function filesIn(dir: string): ZipItem[] {
  const out: ZipItem[] = [];
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push({ name: relative(dir, path).split(sep).join('/'), data: readFileSync(path) });
    }
  };
  walk(dir);
  return out;
}

export const FIXTURES = new URL('./fixtures/looks/', import.meta.url).pathname;

/** A fixture pack as a zip, its look.json changed by `edit` if given. */
export function fixturePack(
  name: 'good' | 'bad',
  edit?: (pack: Record<string, unknown>) => void,
  extra: readonly ZipItem[] = [],
): Buffer {
  const items = filesIn(join(FIXTURES, name)).map((item) => {
    if (item.name !== 'look.json' || !edit) return item;
    const pack = JSON.parse(String(item.data)) as Record<string, unknown>;
    edit(pack);
    return { ...item, data: JSON.stringify(pack) };
  });
  return zip([...items, ...extra]);
}
