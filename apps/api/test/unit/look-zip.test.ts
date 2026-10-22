/**
 * The look pack zip reader (src/looks/zip.ts). Each refusal is tried on its
 * own, with a zip built to tell exactly one lie (test/zip.ts), and each must
 * be refused whole: no file comes back from an archive with one bad entry.
 */
import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { readZip } from '../../src/looks/zip.ts';
import { zip } from '../zip.ts';
import type { ZipItem } from '../zip.ts';

const LIMITS = { entries: 10, fileBytes: 1_000_000, totalBytes: 2_000_000 };
const LOOK = { name: 'look.json', data: '{"id":"x"}' };

function refused(items: ZipItem[], limits = LIMITS): string[] {
  const r = readZip(zip(items), limits);
  if (r.ok)
    throw new Error(`read ${[...r.files.keys()].join(', ')} from an archive it should refuse`);
  return r.problems;
}

describe('an honest zip', () => {
  it('reads every file, stored or deflated, and drops folders', () => {
    const r = readZip(
      zip([
        LOOK,
        { name: 'fonts/' },
        { name: 'fonts/A-400.woff2', data: 'wOF2 and the rest', method: 0 },
      ]),
      LIMITS,
    );
    expect(r.ok && [...r.files.keys()]).toEqual(['look.json', 'fonts/A-400.woff2']);
    expect(r.ok && Buffer.from(r.files.get('look.json') ?? []).toString()).toBe('{"id":"x"}');
  });

  it('reads one with a comment after the end record', () => {
    expect(readZip(zip([LOOK], { comment: 'made by hand' }), LIMITS).ok).toBe(true);
  });

  it('reads an empty file', () => {
    const r = readZip(zip([LOOK, { name: 'empty.txt', data: '' }]), LIMITS);
    expect(r.ok && r.files.get('empty.txt')?.length).toBe(0);
  });
});

describe('paths outside the pack are refused before anything is unpacked', () => {
  it.each([
    ['../look.json', 'points outside the pack'],
    ['fonts/../../etc/passwd', 'points outside the pack'],
    ['/etc/passwd', 'is an absolute path'],
    ['fonts\\..\\look.json', 'has a name this site does not accept'],
    ['C:/look.json', 'has a name this site does not accept'],
    ['fonts//A.woff2', 'has an empty or "." part'],
    ['./look.json', 'has an empty or "." part'],
    ['fonts/a b.woff2', 'has a name this site does not accept'],
    ['fonts/\u00e9.woff2', 'has a name this site does not accept'],
    ['fonts/a\u0000.woff2', 'has a name this site does not accept'],
  ])('%s', (name, sentence) => {
    const problems = refused([LOOK, { name, data: 'x' }]);
    expect(problems.join(' ')).toContain(sentence);
  });

  it('and not one byte of the others is unpacked: a bad entry anywhere refuses the archive', () => {
    // The first file is deliberately damaged: had the reader begun
    // unpacking before checking every name, this would say "damaged".
    const broken = zip([
      { name: 'look.json', data: 'x', crc: 1 },
      { name: '../evil', data: 'x' },
    ]);
    const r = readZip(broken, LIMITS);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems).toEqual([
      '"../evil" points outside the pack. A pack may not use "..".',
    ]);
  });
});

describe('what is not an ordinary file', () => {
  it('a symbolic link', () => {
    expect(refused([LOOK, { name: 'fonts/A.woff2', data: '/etc/passwd', mode: 0o120777 }])).toEqual(
      ['"fonts/A.woff2" is a link. A pack holds only files.'],
    );
  });

  it('a device or a pipe', () => {
    expect(refused([LOOK, { name: 'fifo', data: '', mode: 0o010644 }])).toEqual([
      '"fifo" is not an ordinary file.',
    ]);
  });

  it('the same name twice', () => {
    expect(refused([LOOK, LOOK])).toEqual(['"look.json" is in the pack twice.']);
  });

  it('encryption', () => {
    expect(refused([LOOK, { name: 'a', data: 'x', flags: 1 }])).toEqual([
      '"a" is encrypted. A pack is never encrypted.',
    ]);
  });

  it('a compression method other than stored or deflate', () => {
    expect(refused([{ ...LOOK, method: 12 }])).toEqual([
      '"look.json" is compressed in a way this site does not read. Use ordinary zip.',
    ]);
  });
});

describe('sizes', () => {
  it('a file that declares more than a file may hold', () => {
    expect(refused([{ name: 'big', data: 'x'.repeat(1_000_001) }])).toEqual([
      '"big" is larger than 1 MB.',
    ]);
  });

  it('files that together declare more than a pack may hold', () => {
    const items = [1, 2, 3].map((i) => ({ name: `f${String(i)}`, data: 'x'.repeat(900_000) }));
    expect(refused(items)).toEqual(['The pack is larger than 2 MB.']);
  });

  it('a file that inflates past what it declared (a zip bomb) is stopped there', () => {
    expect(refused([{ name: 'bomb', data: 'x'.repeat(100_000), size: 10 }])).toEqual([
      '"bomb" could not be unpacked, or is larger than it says.',
    ]);
  });

  it('a file shorter than it declared', () => {
    expect(refused([{ name: 'short', data: 'x', size: 5 }])).toEqual([
      '"short" is damaged. Make the .zip again.',
    ]);
  });

  it('too many entries', () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ name: `f${String(i)}`, data: 'x' }));
    expect(refused(items)).toEqual(['The pack has too many files.']);
  });
});

describe('a damaged or dishonest archive', () => {
  it('a checksum that does not match', () => {
    expect(refused([{ ...LOOK, crc: 1234 }])).toEqual([
      '"look.json" is damaged. Make the .zip again.',
    ]);
  });

  it('a local header naming something else than the directory does', () => {
    expect(refused([{ ...LOOK, localName: '../look.json' }])).toEqual([
      '"look.json" says different things in two places. Make the .zip again.',
    ]);
  });

  it('two entries sharing the same bytes', () => {
    const honest = zip([LOOK, { name: 'other', data: 'y' }]);
    // Point the second central entry at the first file's local header.
    const cd = honest.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const second = honest.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), cd + 4);
    honest.writeUInt32LE(0, second + 42);
    const r = readZip(honest, LIMITS);
    expect(!r.ok && r.problems.join(' ')).toMatch(/says different things|share the same bytes/);
  });

  it('ZIP64', () => {
    const z = zip([LOOK]);
    z.writeUInt16LE(0xffff, z.length - 12);
    expect(readZip(z, LIMITS)).toEqual({
      ok: false,
      problems: ['This .zip uses ZIP64, which a look pack never needs. Make an ordinary .zip.'],
    });
  });

  it.each([
    ['nothing at all', Buffer.alloc(0)],
    ['some text', Buffer.from('this is not a zip, honestly, it is just some words')],
    ['raw deflate', deflateRawSync(Buffer.from('x'.repeat(100)))],
    ['a cut-off zip', zip([LOOK]).subarray(0, 30)],
  ])('%s', (_what, bytes) => {
    expect(readZip(bytes, LIMITS)).toEqual({
      ok: false,
      problems: ['This is not a .zip file this site can read.'],
    });
  });
});
