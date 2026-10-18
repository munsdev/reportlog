// The unit suite. No database, no network, no dev dependencies — `npm test`
// on the server, or anywhere.
//
// The first group is the one that matters most: what a report's sealed
// object is, and the absent-key rule that lets it grow without changing the
// fingerprint of a single report already filed.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import canonicalize from 'canonicalize';

/* Source with comments removed, for checks that assert code does NOT do
   something. Without it the explanation of a removal trips the check that
   proves the removal. Declared rather than assigned to a const: tests run
   in file order and several that need it sit above where it used to live,
   which put it in the temporal dead zone. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
import { buildImmutableFields, normalizeReportFields } from '../src/reportCore.js';
import {
  canGrantSystemRole, canChangeSubject, SYSTEM_ROLES, ORG_ROLES, MAY_GRANT,
} from '../src/roles.js';
import { roleSatisfies, hasAdminAuthority } from '../src/roleRank.js';
import { FIELD_TYPE_IDS, fieldType, canFilter } from '../src/fieldTypes.js';
import { normalizeAnswer, buildAnswers } from '../src/answers.js';
import { areaOf } from '../src/mapData.js';
import { FORBIDDEN_KINDS } from '../src/lists/fields.js';
import * as workerModule from '../src/updateWorker.js';
import { REF_PREFIX } from '../src/crypto.js';
import { SEVERITIES, INTAKE_METHODS } from '../src/taxonomy.js';
import { immutableFieldsFor } from '../src/verify.js';
import { formText, formDefinition } from '../src/formText.js';
import {
  normalizeCondition, conditionMet, askedKeys, describeCondition,
} from '../src/conditions.js';
import {
  validateReason, REPORTER_VISIBLE_KINDS, KINDS, MAX_REASON,
} from '../src/accessLog.js';
import { contentHash } from '../src/crypto.js';
import { toTimeString } from '../src/reportCore.js';
import { tag } from '../src/requestLog.js';
import { validateCurtainPassword, MIN_CURTAIN_PASSWORD } from '../src/setup.js';
import {
  resolveLegalText, validateLegalText, editorStartingText, SKELETONS, LEGAL_KINDS,
} from '../src/legalText.js';
import { intakeOpen } from '../src/intakeGate.js';
import { RELEASE_VERSION } from '../src/appVersion.js';
import {
  PROXIED_PATHS, whoAnswered, parseEnabledUnits, missingUnits, EXPECTED_UNITS, SPA_MARKER,
} from '../src/doctor.js';
import {
  backupName, backupTime, ours, prune, backupHealth, checkDir, backupSettings,
  DEFAULT_KEEP, DEFAULT_MAX_AGE_HOURS, restoreCommand,
} from '../src/backup.js';
// Aliased: backup.js exports a DEFAULT_MAX_AGE_HOURS of its own, and the two
// are deliberately different numbers for deliberately different jobs.
import {
  anchorHealth, anchorFault,
  DEFAULT_MAX_AGE_HOURS as ANCHOR_MAX_AGE_HOURS,
} from '../src/anchorHealth.js';
import {
  PALETTES, THEMES, LAYOUTS, PALETTE_IDS, THEME_IDS, LAYOUT_IDS,
  DEFAULT_LOOK, resolveLook, validateLook, parseBrand, isMarked, plainName,
  accentMarksClose, isDarkPalette,
} from '../src/look.js';
import {
  COPY_SLOTS, COPY_KEYS, resolveCopy, editorCopy, validateCopy, MAX_LINE_LEN,
} from '../src/siteCopy.js';
import { paletteColors } from '../src/indexPage.js';
import {
  DESKS, DESK_IDS, PORTAL_TAB_IDS, normalizeDesks, openingTab,
} from '../src/desks.js';
import {
  TEMPLATES, TEMPLATE_IDS, TEMPLATE_KEYS, validateTemplate, templateSummaries,
  logbookStartingPoints, LOGBOOK_STARTING_POINTS,
  describeSettings, templateLogbook,
} from '../src/templates.js';
import { planTemplate } from '../src/applyTemplate.js';
import { publicArchiveEnabled, distributionEnabled } from '../src/publication.js';
import { DISCLAIMER, WHAT_APPEARS, DIRECTORY_NAME } from '../src/alliance.js';
import { missingToolsFor, canProcess } from '../src/media.js';
import { SWEPT } from '../src/sweep.js';
import {
  generateSecrets, validateSiteOrigin, validateDatabaseUrl, renderEnv, readiness,
  regionFromEndpoint, defaultTransparencyLogDir,
} from '../src/installConfig.js';
import { transportFor, readinessFor } from '../src/email.js';
import {
  resolveSiteName, validateSiteName, SOFTWARE_NAME, MAX_SITE_NAME,
} from '../src/siteIdentity.js';
import {
  detectFamily, installCommand, installNotes, databaseSetupCommands,
  nodeVersionOk, TOOL_PACKAGES,
} from '../src/doctor.js';
import {
  mayInvite, needsApproval, ROLE_DESCRIPTIONS,
  MAX_OUTSTANDING_PER_ORG, MAX_PER_DAY_PER_EMAIL, INVITE_TTL_MS,
} from '../src/invitations.js';
import { CARD, cardLines, digestOf } from '../src/consentText.js';
import { chainGenesis, chainHash, sha256Hex } from '../src/crypto.js';
import { checkChainFile, genesisOf, CHAIN_FILE_FORMAT } from '../src/chainCheck.js';
import { headsDigest, ANCHOR_FORMAT } from '../src/chainHeads.js';
import { validateLogbookFile, LOGBOOK_FILE_VERSION } from '../src/logbookFile.js';
import {
  sniffType, stripMetadata, isAllowedType, buildManifest, kindFor, maxBytesFor,
  MAX_FILE_BYTES, MAX_FILES_PER_SUBMISSION, MAX_TOTAL_BYTES,
  MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_AUDIO_BYTES, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_PAGES,
  isRefused, isExcludedFromReport, REFUSED_STATUSES,
  ALLOWED_TYPES, ATTACHMENT_KINDS, ALL_KINDS, enabledKinds, allowedTypesFor, attachmentsEnabled,
  TRIMMED_TYPES, DECODED_IMAGE_TYPES, VIDEO_TYPES, AUDIO_TYPES, DOCUMENT_TYPES,
} from '../src/attachments.js';

let passed = 0;
let failed = 0;

// An async test's promise has to be kept and waited for. This used to call
// fn() and move straight on, so EVERY async test printed "ok" and counted as
// passed before its assertions had run — a rejection became an unhandled
// rejection nobody read. Two real checks sat in that state: the attachment
// columns one and the media cache one. A suite that cannot fail is worse
// than no suite, because it is trusted.
const pending = [];

function test(name, fn) {
  const record = () => { passed += 1; console.log(`  ok   ${name}`); };
  const blame = (e) => {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${e && e.message ? e.message : e}`);
  };
  // An async fn is QUEUED, not started. Starting it here would let every
  // async test run concurrently, and several of them set process.env before
  // a dynamic import reads it — concurrent runs then read each other's
  // values. Queued thunks run one at a time, in source order.
  if (fn.constructor.name === 'AsyncFunction') {
    pending.push(async () => {
      try { await fn(); record(); } catch (e) { blame(e); }
    });
    return;
  }
  try {
    fn();
    record();
  } catch (e) {
    blame(e);
  }
}

// Called once, immediately before the totals. Async tests report here rather
// than in source order; that is the cost of not rewriting 400 call sites, and
// it is worth paying to have them report at all.
async function settlePendingTests() {
  if (!pending.length) return;
  console.log('\nasync checks');
  for (const run of pending) await run();
}

function group(name) {
  console.log(`\n${name}`);
}

/* ------------------------------------------------------------------ */
group('the hashed object — one shape, and the rules that keep it cheap');

// A digest standing in for the publication card's wording.
const DIGEST = 'd'.repeat(64);

// Exactly what insertReportVersion builds, written out by hand. If these
// two ever disagree, the archive is hashing something other than what
// this file says it hashes.
const sampleFields = {
  public_ref: 'RL-ABC123-XYZ789',
  received_at: '2026-08-26T10:00:00.000Z',
  thread_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  corrects_id: null,
  logbook: 'election-day',
  answers: { outcome: 'Something went wrong', state: 'Ohio', what: ['Long lines or wait times'] },
  may_publish: true,
  may_publish_digest: DIGEST,
};

const args = {
  recipe: 1,
  publicRef: sampleFields.public_ref,
  receivedAt: sampleFields.received_at,
  threadId: sampleFields.thread_id,
  correctsId: null,
  fields: normalizeReportFields({
    logbook: 'election-day',
    answers: sampleFields.answers,
    may_publish: true,
    may_publish_digest: DIGEST,
  }),
};

test('a report is its logbook, its answers and its publication answer — nothing built in', () => {
  const built = buildImmutableFields({ ...args });
  assert.deepEqual(Object.keys(built).sort(), [
    'answers', 'corrects_id', 'logbook', 'may_publish', 'may_publish_digest',
    'public_ref', 'received_at', 'thread_id',
  ]);
  for (const gone of ['narrative', 'states', 'categories', 'incident_date', 'severity',
    'observer_status', 'direct_or_secondhand', 'taxonomy_version', 'county_commitment']) {
    assert.ok(!(gone in built), `${gone} is not part of a report any more`);
  }
});

test('a report with nothing answered has NO answers key — absent, not {}', () => {
  const f = normalizeReportFields({ logbook: 'x', answers: {}, may_publish: false, may_publish_digest: DIGEST });
  assert.ok(!('answers' in f));
  const g = normalizeReportFields({ logbook: 'x', may_publish: false, may_publish_digest: DIGEST });
  assert.ok(!('answers' in g));
  assert.equal(contentHash({ ...g }), contentHash({ ...f }));
});

test('every report names its logbook, and the publication answer is required', () => {
  assert.throws(() => normalizeReportFields({ answers: {}, may_publish: true, may_publish_digest: DIGEST }));
  assert.throws(() => normalizeReportFields({ logbook: 'x', may_publish_digest: DIGEST }));
  assert.throws(() => normalizeReportFields({ logbook: 'x', may_publish: true }));
  assert.throws(() => normalizeReportFields({ logbook: 'x', may_publish: true, may_publish_digest: 'short' }));
  // Declining is a real answer, sealed as false.
  assert.equal(normalizeReportFields({ logbook: 'x', may_publish: false, may_publish_digest: DIGEST }).may_publish, false);
});

test('an optional question added later changes no report already filed', () => {
  // The one opening a launched logbook has, and the reason it is safe: a
  // report that never answered the new question has no key for it.
  const before = contentHash(buildImmutableFields({ ...args }));
  const again = contentHash(buildImmutableFields({
    ...args, fields: normalizeReportFields({ logbook: 'election-day', answers: { ...sampleFields.answers }, may_publish: true, may_publish_digest: DIGEST }),
  }));
  assert.equal(before, again);
});

test('no attachments produces the identical canonical JSON', () => {
  assert.equal(
    canonicalize(buildImmutableFields({ ...args, attachmentManifest: null })),
    canonicalize(sampleFields),
  );
});

test('no attachments produces the identical content_hash', () => {
  assert.equal(
    contentHash(buildImmutableFields({ ...args, attachmentManifest: null })),
    contentHash(sampleFields),
  );
});

// The three ways "nothing attached" can reach this function all have to
// collapse to the same hash, or the recipe depends on a caller's accident.
test('undefined, null and empty manifests are all indistinguishable', () => {
  const h = contentHash(sampleFields);
  assert.equal(contentHash(buildImmutableFields({ ...args })), h);
  assert.equal(contentHash(buildImmutableFields({ ...args, attachmentManifest: null })), h);
  assert.equal(contentHash(buildImmutableFields({ ...args, attachmentManifest: [] })), h);
});

test('no attachments means no attachments key at all', () => {
  assert.ok(!('attachments' in buildImmutableFields({ ...args, attachmentManifest: [] })));
});

test('an attachment does change the hash', () => {
  const manifest = [{ ordinal: 0, sha256: 'a'.repeat(64), byte_size: 1234, media_type: 'image/jpeg' }];
  assert.notEqual(
    contentHash(buildImmutableFields({ ...args, attachmentManifest: manifest })),
    contentHash(sampleFields),
  );
});

test('changing one attachment byte-count changes the hash', () => {
  const a = [{ ordinal: 0, sha256: 'a'.repeat(64), byte_size: 1234, media_type: 'image/jpeg' }];
  const b = [{ ordinal: 0, sha256: 'a'.repeat(64), byte_size: 1235, media_type: 'image/jpeg' }];
  assert.notEqual(
    contentHash(buildImmutableFields({ ...args, attachmentManifest: a })),
    contentHash(buildImmutableFields({ ...args, attachmentManifest: b })),
  );
});

test('attachment order is part of what is committed to', () => {
  const one = { ordinal: 0, sha256: 'a'.repeat(64), byte_size: 10, media_type: 'image/png' };
  const two = { ordinal: 1, sha256: 'b'.repeat(64), byte_size: 20, media_type: 'image/png' };
  assert.notEqual(
    contentHash(buildImmutableFields({ ...args, attachmentManifest: [one, two] })),
    contentHash(buildImmutableFields({
      ...args,
      attachmentManifest: [{ ...two, ordinal: 0 }, { ...one, ordinal: 1 }],
    })),
  );
});

test('buildManifest returns null rather than an empty array', () => {
  assert.equal(buildManifest([]), null);
});

test('the recipe writes no recipe key, so its absence identifies it', () => {
  // Writing `recipe: 1` explicitly would change the hash of every report
  // in the archive. Absence is the marker, exactly as it is for
  // attachments and for every optional key.
  assert.ok(!('recipe' in buildImmutableFields({ ...args })));
});

test('a correction commits to a number, not to the string pg hands back', () => {
  // pg returns bigints as strings. A correction that hashed "1" where the
  // verifier rebuilds 1 would never verify again, so the number form is
  // settled inside buildImmutableFields rather than at each call site.
  assert.equal(buildImmutableFields({ ...args, correctsId: '7' }).corrects_id, 7);
  assert.equal(buildImmutableFields({ ...args, correctsId: null }).corrects_id, null);
});

/* ------------------------------------------------------------------ */
group('type sniffing — the browser is never believed');

const jpegMagic = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

test('detects JPEG', () => assert.equal(sniffType(jpegMagic), 'image/jpeg'));
test('detects PNG', () => assert.equal(sniffType(pngMagic), 'image/png'));
test('detects WebP', () => {
  const webp = Buffer.concat([
    Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'),
  ]);
  assert.equal(sniffType(webp), 'image/webp');
});
test('detects a PDF by its header, wherever it starts', () => {
  assert.equal(sniffType(Buffer.from('%PDF-1.7\n', 'latin1')), 'application/pdf');
  // The spec allows the header within the first 1024 bytes and every
  // reader accepts it there, so refusing to look past byte 0 would reject
  // files that open fine everywhere else.
  assert.equal(sniffType(Buffer.concat([
    Buffer.alloc(20, 0x20), Buffer.from('%PDF-1.4\n', 'latin1'),
  ])), 'application/pdf');
});
test('detects audio, including the RIFF collision with WebP', () => {
  const riff = (tag) => Buffer.concat([
    Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from(tag, 'latin1'),
  ]);
  // Both start RIFF. Reading only the first four bytes would call a voice
  // memo a photo, which is the sort of mistake that ends with an image
  // decoder being handed a wav file.
  assert.equal(sniffType(riff('WAVE')), 'audio/wav');
  assert.equal(sniffType(riff('WEBP')), 'image/webp');
  assert.equal(sniffType(Buffer.from('ID3\x04\x00\x00\x00', 'latin1')), 'audio/mpeg');
  assert.equal(sniffType(Buffer.from('OggS', 'latin1')), 'audio/ogg');
});
test('rejects an ELF binary', () => {
  assert.equal(sniffType(Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00])), null);
});
test('rejects an empty file', () => assert.equal(sniffType(Buffer.alloc(0)), null));
// The ISO base media container is shared by HEIC photos and MP4/MOV
// video; only the brand in the ftyp box separates them, so getting this
// wrong would route a video through the photo path or vice versa.
function ftyp(brand) {
  return Buffer.concat([
    Buffer.alloc(4), Buffer.from('ftyp', 'latin1'), Buffer.from(brand, 'latin1'), Buffer.alloc(8),
  ]);
}

test('detects a HEIC photo', () => assert.equal(sniffType(ftyp('heic')), 'image/heic'));
test('detects an iPhone QuickTime video', () => assert.equal(sniffType(ftyp('qt  ')), 'video/quicktime'));
test('detects an MP4', () => assert.equal(sniffType(ftyp('isom')), 'video/mp4'));
test('detects WebM', () => {
  assert.equal(sniffType(Buffer.from([0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0])), 'video/webm');
});
test('an unknown ISO brand is not accepted', () => {
  assert.equal(sniffType(ftyp('xxxx')), null);
});
test('HEIC and video are now on the allow-list', () => {
  for (const t of ['image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm']) {
    assert.ok(isAllowedType(t), `${t} should be allowed`);
  }
});
test('audio-only MP4 is told apart from video in the same container', () => {
  // An M4A voice memo and an MP4 clip are the same container; only the
  // brand separates them. Getting this wrong sends audio down the video
  // path, which then looks for a video stream that is not there.
  assert.equal(sniffType(ftyp('M4A ')), 'audio/mp4');
  assert.equal(sniffType(ftyp('isom')), 'video/mp4');
});
test('audio and PDF are now on the allow-list; SVG never will be', () => {
  for (const t of ['audio/mpeg', 'audio/mp4', 'audio/wav', 'application/pdf']) {
    assert.ok(isAllowedType(t), `${t} should be allowed`);
  }
  // SVG is markup that a browser executes. There is no version of this
  // system that publishes one.
  assert.equal(isAllowedType('image/svg+xml'), false);
});
test('every allowed type belongs to exactly one kind', () => {
  for (const t of ALLOWED_TYPES) {
    assert.ok(kindFor(t), `${t} has no kind`);
    const families = ALL_KINDS.filter((k) => ATTACHMENT_KINDS[k].includes(t));
    assert.equal(families.length, 1, `${t} is in ${families.length} families: ${families}`);
  }
});
test('the admin list defaults to everything, and empty means none', () => {
  // NULL is "no opinion, use the code's full list" — an install that never
  // touches the setting must keep working. An empty array is a real answer
  // and must NOT collapse into the same thing.
  assert.deepEqual(enabledKinds(null), ALL_KINDS);
  assert.deepEqual(enabledKinds({ attachment_kinds: null }), ALL_KINDS);
  assert.deepEqual(enabledKinds({ attachment_kinds: [] }), []);
  assert.deepEqual(enabledKinds({ attachment_kinds: ['photo', 'nonsense'] }), ['photo']);
  assert.deepEqual(allowedTypesFor({ attachment_kinds: [] }), []);
});
test('the stored switch beats the environment, and storage beats both', () => {
  const env = process.env.ATTACHMENTS_ENABLED;
  try {
    process.env.ATTACHMENTS_ENABLED = 'true';
    // Storage is not configured in the test environment, so nothing an
    // admin can press may report the feature as on. A switch that says
    // yes while there is nowhere to put a file is a switch that lies.
    assert.equal(attachmentsEnabled({ attachments_enabled: true }), false);
  } finally {
    if (env === undefined) delete process.env.ATTACHMENTS_ENABLED;
    else process.env.ATTACHMENTS_ENABLED = env;
  }
});

/* ------------------------------------------------------------------ */
group('metadata stripping — GPS must not reach the public bucket');

// A synthetic but structurally real JPEG: SOI, JFIF APP0, an EXIF APP1
// carrying a recognisable GPS string, a comment, then SOS + entropy data
// and EOI.
function syntheticJpeg() {
  const seg = (marker, payload) => Buffer.concat([
    Buffer.from([0xFF, marker]),
    (() => { const b = Buffer.alloc(2); b.writeUInt16BE(payload.length + 2); return b; })(),
    payload,
  ]);
  return Buffer.concat([
    Buffer.from([0xFF, 0xD8]),
    seg(0xE0, Buffer.concat([Buffer.from('JFIF\0', 'latin1'), Buffer.alloc(9)])),
    seg(0xE1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from('GPSLatitude=52.5200 GPSLongitude=13.4050', 'latin1')])),
    seg(0xFE, Buffer.from('Shot on SecretCamera 9000', 'latin1')),
    seg(0xDB, Buffer.alloc(65)),
    Buffer.from([0xFF, 0xDA]), Buffer.from([0x00, 0x08, 0x01, 0x01, 0x00, 0x00]),
    Buffer.from([0x12, 0x34, 0x56, 0x78]),
    Buffer.from([0xFF, 0xD9]),
  ]);
}

test('JPEG: GPS is gone from the stripped bytes', () => {
  const { clean } = stripMetadata(syntheticJpeg(), 'image/jpeg');
  assert.ok(!clean.toString('latin1').includes('GPSLatitude'), 'GPS survived the strip');
});

test('JPEG: the camera comment is gone too', () => {
  const { clean } = stripMetadata(syntheticJpeg(), 'image/jpeg');
  assert.ok(!clean.toString('latin1').includes('SecretCamera'));
});

test('JPEG: it is still a JPEG afterwards', () => {
  const { clean } = stripMetadata(syntheticJpeg(), 'image/jpeg');
  assert.equal(sniffType(clean), 'image/jpeg');
  assert.deepEqual(clean.subarray(-2), Buffer.from([0xFF, 0xD9]));
});

test('JPEG: image data survives untouched', () => {
  const { clean } = stripMetadata(syntheticJpeg(), 'image/jpeg');
  assert.ok(clean.includes(Buffer.from([0x12, 0x34, 0x56, 0x78])), 'entropy data was damaged');
});

test('JPEG: JFIF is kept, EXIF and COM are reported removed', () => {
  const { clean, metadata } = stripMetadata(syntheticJpeg(), 'image/jpeg');
  assert.ok(clean.toString('latin1').includes('JFIF'), 'JFIF should be preserved');
  assert.equal(metadata.removed.length, 2);
});

test('JPEG: stripping is idempotent', () => {
  const once = stripMetadata(syntheticJpeg(), 'image/jpeg').clean;
  const twice = stripMetadata(once, 'image/jpeg').clean;
  assert.deepEqual(twice, once);
});

function pngChunk(type, payload) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), payload]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crcBuf]);
}

// Only needed so the fixture is a well-formed PNG; the stripper itself
// never validates CRCs.
function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c;
}

function syntheticPng() {
  return Buffer.concat([
    pngMagic,
    pngChunk('IHDR', Buffer.alloc(13)),
    pngChunk('tEXt', Buffer.from('Comment\0taken at 52.5200,13.4050', 'latin1')),
    pngChunk('eXIf', Buffer.from('GPSLatitude', 'latin1')),
    pngChunk('IDAT', Buffer.from([0xAB, 0xCD, 0xEF])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('PNG: text and eXIf chunks are removed', () => {
  const { clean, metadata } = stripMetadata(syntheticPng(), 'image/png');
  const s = clean.toString('latin1');
  assert.ok(!s.includes('52.5200'));
  assert.ok(!s.includes('GPSLatitude'));
  assert.equal(metadata.removed.length, 2);
});

test('PNG: IHDR, IDAT and IEND survive', () => {
  const { clean } = stripMetadata(syntheticPng(), 'image/png');
  assert.equal(sniffType(clean), 'image/png');
  assert.ok(clean.includes(Buffer.from([0xAB, 0xCD, 0xEF])));
  assert.ok(clean.toString('latin1').endsWith('IEND') || clean.toString('latin1').includes('IEND'));
});

test('WebP: EXIF chunk is removed and the header size is rewritten', () => {
  const chunk = (fourcc, payload) => {
    const size = Buffer.alloc(4);
    size.writeUInt32LE(payload.length);
    return Buffer.concat([Buffer.from(fourcc, 'latin1'), size, payload,
      payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const body = Buffer.concat([
    chunk('VP8 ', Buffer.from([1, 2, 3, 4])),
    chunk('EXIF', Buffer.from('GPSLatitude=52.52', 'latin1')),
  ]);
  const header = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1')]);
  header.writeUInt32LE(body.length + 4, 4);

  const { clean } = stripMetadata(Buffer.concat([header, body]), 'image/webp');
  assert.ok(!clean.toString('latin1').includes('GPSLatitude'));
  assert.equal(sniffType(clean), 'image/webp');
  assert.equal(clean.readUInt32LE(4), clean.length - 8, 'RIFF size field is wrong');
});

test('a truncated file fails to parse rather than hanging', () => {
  const truncated = syntheticJpeg().subarray(0, 12);
  const { clean } = stripMetadata(truncated, 'image/jpeg');
  assert.ok(Buffer.isBuffer(clean));
});

/* ------------------------------------------------------------------ */
group('envelope encryption');

// crypto.js reads the key from the environment at call time, so a test key
// is enough — this never touches the real one.
process.env.TIER_B_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
const { generateDek, encryptBuffer, decryptBuffer, wrapDek, unwrapDek } = await import('../src/crypto.js');

test('a buffer round-trips through its data key', () => {
  const dek = generateDek();
  const plain = crypto.randomBytes(4096);
  assert.deepEqual(decryptBuffer(encryptBuffer(plain, dek), dek), plain);
});

test('a data key round-trips through the master key', () => {
  const dek = generateDek();
  assert.deepEqual(unwrapDek(wrapDek(dek)), dek);
});

test('the wrong key cannot open the ciphertext', () => {
  const packed = encryptBuffer(Buffer.from('evidence'), generateDek());
  assert.throws(() => decryptBuffer(packed, generateDek()));
});

test('tampering with the ciphertext is detected', () => {
  const dek = generateDek();
  const packed = encryptBuffer(Buffer.from('evidence'), dek);
  packed[packed.length - 1] ^= 0xFF;
  assert.throws(() => decryptBuffer(packed, dek));
});

test('destroying the key makes the content unrecoverable', () => {
  // This is the crypto-shredding claim, stated as a test: after the wrapped
  // key is gone there is no path from ciphertext back to content, while the
  // digest that sits in the hash chain is still perfectly valid.
  const dek = generateDek();
  const plain = Buffer.from('a photograph of a polling place');
  const digest = crypto.createHash('sha256').update(plain).digest('hex');
  const packed = encryptBuffer(plain, dek);

  const wrapped = null; // what the erase endpoint leaves behind
  assert.equal(unwrapDek(wrapped), null);
  assert.equal(digest.length, 64, 'the digest in the chain is untouched');
  assert.throws(() => decryptBuffer(packed, generateDek()));
});

/* ------------------------------------------------------------------ */
group('feature flag — off means absent');

test('attachment columns vanish from queries when disabled', async () => {
  assert.equal(process.env.ATTACHMENTS_ENABLED, undefined);
});

const { attachmentColumns } = await import('../src/attachments.js');

test('attachmentsEnabled is false without the flag', () => {
  assert.equal(attachmentsEnabled(), false);
});

test('attachmentColumns adds nothing to SQL when disabled', () => {
  assert.equal(attachmentColumns(), '');
});

test('the flag alone is not enough without storage configured', () => {
  process.env.ATTACHMENTS_ENABLED = 'true';
  assert.equal(attachmentsEnabled(), false, 'must also require storage configuration');
  delete process.env.ATTACHMENTS_ENABLED;
});

/* ------------------------------------------------------------------ */
group('request signing');

const storageMod = await import('../src/storage.js');
const { presign } = storageMod;

test('presigned URLs carry every required SigV4 parameter', () => {
  process.env.S3_ENDPOINT = 'https://fsn1.your-objectstorage.com';
  process.env.S3_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
  process.env.S3_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  process.env.S3_REGION = 'eu-central-1';

  const url = presign('PUT', 'example-staging', 'staging/abc123');
  for (const p of ['X-Amz-Algorithm=AWS4-HMAC-SHA256', 'X-Amz-Credential=',
    'X-Amz-Date=', 'X-Amz-Expires=', 'X-Amz-SignedHeaders=host', 'X-Amz-Signature=']) {
    assert.ok(url.includes(p), `missing ${p}`);
  }
  assert.ok(url.startsWith('https://fsn1.your-objectstorage.com/example-staging/staging/abc123?'));
});

test('a different key produces a different signature', () => {
  const a = presign('PUT', 'b', 'k');
  process.env.S3_SECRET_KEY = 'a-completely-different-secret-key-value';
  const b = presign('PUT', 'b', 'k');
  assert.notEqual(a.split('X-Amz-Signature=')[1], b.split('X-Amz-Signature=')[1]);
});

test('keys with awkward characters are encoded, not passed through', () => {
  const url = presign('GET', 'example-evidence', 'evidence/a b+c&d');
  assert.ok(!url.split('?')[0].includes(' '));
  assert.ok(!url.split('?')[0].includes('+'));
  assert.ok(url.includes('%20'));
});

test('virtual-hosted addressing puts the bucket in the host and signs it there', () => {
  // S3_ADDRESSING=virtual exists because AWS S3 proper is deprecating
  // path-style, and a bucket in a newer region can refuse it outright.
  process.env.S3_ENDPOINT = 'https://s3.eu-central-1.amazonaws.com';
  process.env.S3_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
  process.env.S3_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  process.env.S3_REGION = 'eu-central-1';
  process.env.S3_ADDRESSING = 'virtual';

  const url = new URL(presign('PUT', 'example-staging', 'staging/abc123'));
  assert.equal(url.host, 'example-staging.s3.eu-central-1.amazonaws.com',
    'the bucket is not in the host');
  assert.equal(url.pathname, '/staging/abc123',
    'the bucket is in the host AND still in the path');
  // The host is what gets signed, so a URL whose host is the bare endpoint
  // would carry a signature for a different request.
  assert.ok(!url.host.startsWith('s3.'), 'the returned host is the endpoint, not the bucket');

  process.env.S3_ADDRESSING = 'path';
});

test('a bucket that cannot be a DNS label is refused rather than signed', () => {
  process.env.S3_ADDRESSING = 'virtual';
  // A dot breaks TLS against a wildcard certificate — the upload fails in
  // the browser with a certificate error that names nothing about S3.
  assert.throws(() => presign('PUT', 'my.bucket', 'k'), /breaks TLS|cannot be addressed/);
  assert.throws(() => presign('PUT', 'MyBucket', 'k'), /lowercase|cannot be addressed/);
  process.env.S3_ADDRESSING = 'path';
  // Path-style has no such constraint, so the same bucket is fine there.
  assert.ok(presign('PUT', 'my.bucket', 'k').includes('my.bucket'));
});

test('a misspelt addressing mode is named, not silently ignored', () => {
  // Falling back to path-style on a typo would fail against a
  // virtual-hosted-only endpoint as a signature mismatch, which names
  // nothing useful.
  process.env.S3_ADDRESSING = 'virtualhosted';
  assert.throws(() => presign('PUT', 'b', 'k'), /S3_ADDRESSING must be one of/);
  process.env.S3_ADDRESSING = 'path';
});

test('both addressing modes match botocore, byte for byte', () => {
  // KNOWN-ANSWER TEST. These two signatures were produced by botocore's own
  // S3SigV4QueryAuth — AWS's implementation, not a second copy of ours — for
  // the same request at the same instant, and checked on 6 October 2026
  // against src/storage.js in both modes. They are the only thing in this
  // suite that proves the hand-rolled SigV4 agrees with the thing it is
  // imitating; everything else only proves it agrees with itself.
  //
  // Regenerating them needs botocore and a frozen clock. If one of these
  // fails, the signing changed, and no endpoint will accept the new form.
  const vectors = [
    { addressing: 'virtual',
      amzDate: '20261006T164203Z',
      signature: '2f2ee4a105a5bc4ab1bb23de71b075c5edf14b1597b75d603c940da69394174d' },
    { addressing: 'path',
      amzDate: '20261006T164203Z',
      signature: 'cddcd732dbc84b21719687043ddfb8d7b75fca1a84040d00be714bccb51e817e' },
  ];

  process.env.S3_ENDPOINT = 'https://s3.eu-central-1.amazonaws.com';
  process.env.S3_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
  process.env.S3_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  process.env.S3_REGION = 'eu-central-1';

  const RealDate = Date;
  try {
    for (const v of vectors) {
      const d = v.amzDate;
      const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T`
        + `${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`;
      const fixed = new RealDate(iso);
      globalThis.Date = class extends RealDate {
        constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(fixed); }
        static now() { return fixed.getTime(); }
      };
      process.env.S3_ADDRESSING = v.addressing;
      const got = new URL(presign('PUT', 'example-staging', 'staging/abc123',
        { expiresIn: 900 })).searchParams.get('X-Amz-Signature');
      assert.equal(got, v.signature,
        `${v.addressing}-style signature no longer matches botocore's`);
    }
  } finally {
    globalThis.Date = RealDate;
    process.env.S3_ADDRESSING = 'path';
  }
});

test('the guides describe the addressing the code actually implements', () => {
  // INSTALL.md said "Any S3-compatible provider works" while presign() was
  // path-style only, and the single place that admitted it was a comment in
  // src/storage.js. Somebody on AWS would have hit SignatureDoesNotMatch
  // with the guide insisting their provider was fine.
  const storageSrc = fs.readFileSync(new URL('../src/storage.js', import.meta.url), 'utf8');
  const reference = fs.readFileSync(new URL('../docs/reference.md', import.meta.url), 'utf8');
  // Read here rather than using the installMd further down this file: that
  // binding belongs to the guide-drift group, which runs after this one.
  const guide = fs.readFileSync(new URL('../INSTALL.md', import.meta.url), 'utf8');
  const rendered = fs.readFileSync(new URL('../public/docs.html', import.meta.url), 'utf8');

  // The modes the code offers, read from the code rather than restated.
  const declared = storageSrc.match(/export const ADDRESSING_MODES = \[([^\]]+)\]/);
  assert.ok(declared, 'storage.js no longer declares its addressing modes');
  const modes = [...declared[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(modes, ['path', 'virtual'], 'the modes changed');

  // All three, including the rendered guide: docs.html is the hand-holding
  // one, so a reader on AWS following it rather than the markdown must not
  // be the one left with SignatureDoesNotMatch and no explanation.
  for (const [what, text] of [['INSTALL.md', guide], ['reference.md', reference],
    ['public/docs.html', rendered]]) {
    assert.ok(text.includes('S3_ADDRESSING'),
      `${what} never mentions S3_ADDRESSING, so nothing tells an operator it exists`);
    for (const mode of modes) {
      // Markdown writes it in backticks, the rendered guide in <code>.
      const named = text.includes(`\`${mode}\``) || text.includes(`<code>${mode}</code>`);
      assert.ok(named, `${what} does not document the ${mode} addressing mode`);
    }
    // The claim that bit us: no document may say any provider works without
    // naming the setting that decides it.
    assert.ok(!/Any S3-compatible provider works/.test(text),
      `${what} still claims any S3-compatible provider works`);
    // AWS is the reason virtual exists; a reader on AWS must be told.
    assert.match(text, /AWS S3/, `${what} does not mention AWS S3 at all`);
    // And the smoke script is how it gets settled against a real endpoint.
    assert.ok(text.includes('storage-smoke'),
      `${what} does not point at npm run storage-smoke`);
  }

  // Path-style must stay the default: the deployment that exists runs on
  // Hetzner, and a default flip would break it on upgrade.
  assert.match(storageSrc, /S3_ADDRESSING \|\| 'path'/,
    'path-style is no longer the default, which would break the live deployment');
});

test('object keys are random, never derived from an id', () => {
  const { randomKey } = storageMod;
  const a = randomKey('rendition');
  const b = randomKey('rendition');
  assert.notEqual(a, b, 'keys must not repeat');
  assert.match(a, /^rendition\/[0-9a-f]{32}$/);
  // The failure this guards against: rendition/1, rendition/2, … is
  // enumerable the moment a bucket policy is loosened by accident.
  assert.ok(!/\/\d+$/.test(a), 'key must not end in a bare number');
});

/* ------------------------------------------------------------------ */
group('updates');

const upd = await import('../src/updates.js');

test('versions compare numerically, so v0.0.10 is above v0.0.9', () => {
  // The bug this prevents is a string compare, under which "0.0.10" sorts
  // below "0.0.9" and a deployment is told it is up to date when it is not.
  assert.equal(upd.compareVersions('v0.0.10', 'v0.0.9'), 1);
  assert.equal(upd.compareVersions('v0.0.9', 'v0.0.10'), -1);
  assert.equal(upd.compareVersions('v0.1.0', 'v0.0.99'), 1);
  assert.equal(upd.compareVersions('v0.0.3', 'v0.0.3'), 0);
  // Unparseable is 0 rather than a throw: this reads a file people edit.
  assert.equal(upd.compareVersions('nonsense', 'v0.0.3'), 0);
  assert.equal(upd.parseVersion('v0.0.02'), null, 'a padded component is not a version');
});

test('the changelog parses into entries, newest first', () => {
  const text = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const entries = upd.parseChangelog(text);
  assert.ok(entries.length >= 2, `only ${entries.length} release(s) in CHANGELOG.md`);

  /* THE SHIPPED RELEASE is the one that has to be complete — dated, with real
     notes. It is not necessarily the first entry: notes for the NEXT release
     are written as the work lands rather than on release day (the project's
     rule is that nothing is owed when the version moves), so the file
     legitimately carries one undated entry above it. That entry is invisible
     in the pane until `package.json` catches up, because `updateState` only
     reads notes for a version NEWER than the running one.
     This used to assert `entries[0].version === RELEASE_VERSION`, which made
     writing the next entry ahead of time fail the suite — punishing exactly
     the habit the changelog asks for. */
  const shipped = entries.find((e) => e.version === RELEASE_VERSION);
  assert.ok(shipped, `CHANGELOG.md has no entry for the shipped ${RELEASE_VERSION}`);
  assert.ok(shipped.date, `${RELEASE_VERSION} has shipped and carries no date`);
  assert.ok(shipped.notes.length > 50, `${RELEASE_VERSION} has no real notes`);

  // At most one unreleased entry, and only above the shipped one. More than
  // that means a version was skipped or the file is being used as a scratchpad.
  const ahead = entries.slice(0, entries.indexOf(shipped));
  assert.ok(ahead.length <= 1,
    `${ahead.length} entries sit above the shipped ${RELEASE_VERSION}: `
    + ahead.map((e) => e.version).join(', '));
  for (const e of ahead) {
    assert.ok(e.notes.length > 50, `${e.version} is listed with no real notes`);
  }

  // Descending, so the pane can render it without sorting.
  for (let i = 1; i < entries.length; i += 1) {
    assert.equal(upd.compareVersions(entries[i - 1].version, entries[i].version), 1,
      `CHANGELOG.md is out of order at ${entries[i].version}`);
  }
});

test('the changelog documents the version the software reports', () => {
  // The pane's whole job is answering "what am I about to run". A release
  // that shipped without an entry makes that unanswerable.
  const text = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const versions = upd.parseChangelog(text).map((e) => e.version);
  assert.ok(versions.includes(RELEASE_VERSION),
    `the software reports ${RELEASE_VERSION} and CHANGELOG.md does not mention it`);
});

test('a deployment several releases behind is shown every one of them', () => {
  const entries = [
    { version: 'v0.3.0', date: '', notes: 'three' },
    { version: 'v0.2.0', date: '', notes: 'two' },
    { version: 'v0.1.0', date: '', notes: 'one' },
  ];
  const between = upd.versionsBetween(entries, 'v0.1.0', 'v0.3.0');
  assert.deepEqual(between.map((e) => e.version), ['v0.3.0', 'v0.2.0'],
    'the releases being moved through are not all listed');
  // The one you are ON is not something you are about to apply.
  assert.ok(!between.some((e) => e.version === 'v0.1.0'));
  // And nothing above what is on offer, even if the file knows about it.
  assert.deepEqual(upd.versionsBetween(entries, 'v0.1.0', 'v0.2.0').map((e) => e.version),
    ['v0.2.0']);
});

test('commits ahead within the same version still count as an update', () => {
  // Most releases are several commits, and stable moves between version
  // bumps. "Same version, nothing to do" would hide almost every update.
  const same = upd.updateState({ currentVersion: 'v0.0.3', availableVersion: 'v0.0.3', behind: 4 });
  assert.equal(same.hasUpdate, true);
  assert.equal(same.releases.length, 0, 'no release boundary was crossed');

  const none = upd.updateState({ currentVersion: 'v0.0.3', availableVersion: 'v0.0.3', behind: 0 });
  assert.equal(none.hasUpdate, false);
});

test('a release with no changelog entry is reported, not hidden', () => {
  const state = upd.updateState({
    currentVersion: 'v0.0.3', availableVersion: 'v0.1.0', behind: 9, entries: [],
  });
  assert.equal(state.hasUpdate, true);
  assert.equal(state.undocumented, true,
    'an undocumented release must say so on the one screen where somebody decides');
});

test('a request must name a full commit id, never a branch or a shorthand', () => {
  // The root worker will only apply a request whose target is the exact tip
  // it fetched. A branch name would be a request to run "whatever is there
  // when you get round to it", which is the thing being avoided.
  const sha = 'a'.repeat(40);
  const req = upd.buildRequest({ targetCommit: sha, requestedBy: '7', requestId: 'r1' });
  assert.equal(req.targetCommit, sha);
  assert.ok(req.requestedAt, 'a request with no timestamp cannot expire');

  for (const bad of ['stable', 'main', 'abc1234', '', null, `${sha}x`, 'A'.repeat(40)]) {
    assert.throws(() => upd.buildRequest({ targetCommit: bad }), /full 40-character commit/,
      `${JSON.stringify(bad)} was accepted as a target`);
  }
});

test('a stale request is refused, and so is one dated in the future', () => {
  const sha = 'b'.repeat(40);
  const now = new Date('2026-10-07T12:00:00Z');
  const fresh = upd.buildRequest({ targetCommit: sha, requestId: 'r', now });
  assert.equal(upd.validateRequest(fresh, { now }).ok, true);

  // Applying an hour-old request installs something nobody has looked at
  // since it was approved.
  const old = { ...fresh, requestedAt: '2026-10-07T11:00:00Z' };
  const oldResult = upd.validateRequest(old, { now });
  assert.equal(oldResult.ok, false);
  assert.match(oldResult.reason, /expired/);

  const future = { ...fresh, requestedAt: '2026-10-07T13:00:00Z' };
  assert.equal(upd.validateRequest(future, { now }).ok, false);

  assert.equal(upd.validateRequest(null, { now }).ok, false);
  assert.equal(upd.validateRequest({ targetCommit: 'stable' }, { now }).ok, false);
});

test('an unknown worker state reads as idle rather than crashing the pane', () => {
  assert.equal(upd.normalizeStatus(null).state, 'idle');
  assert.equal(upd.normalizeStatus({ state: 'exploding' }).state, 'idle');
  assert.equal(upd.normalizeStatus({ state: 'running' }).state, 'running');
  assert.equal(upd.normalizeStatus({ state: 'done', commit: 'z'.repeat(40) }).commit, null,
    'a commit that is not a commit must not be shown as one');
});

test('the button is closed while an apply is in flight', () => {
  // Two applies at once means one npm ci running while the other restarts.
  assert.equal(upd.isBusy({ state: 'queued' }), true);
  assert.equal(upd.isBusy({ state: 'running' }), true);
  assert.equal(upd.isBusy({ state: 'done' }), false);
  assert.equal(upd.isBusy(null), false);
});

test('nothing in the update path can compute a fingerprint or reach the db', () => {
  // Same rule as the permissions log: this module is operational state and
  // must never get near the hashed object.
  const src = fs.readFileSync(new URL('../src/updates.js', import.meta.url), 'utf8');
  // Named precisely: an earlier version of this list banned the substring
  // "exec" and caught RegExp.prototype.exec, which is not a power.
  for (const forbidden of ['db.js', 'reportCore', 'canonicalize', 'createHash',
    'child_process', 'execSync', 'execFile', 'spawnSync', 'node:fs', 'fetch(']) {
    assert.ok(!src.includes(forbidden),
      `src/updates.js references ${forbidden}; it is meant to have no power at all`);
  }
});

/* ------------------------------------------------------------------ */
group('quota arithmetic');

test('any single file stays under the per-report total', () => {
  assert.ok(MAX_FILE_BYTES < MAX_TOTAL_BYTES);
});

test('the total cap, not the file count, is what bounds a draft', () => {
  // Ten videos at the per-file cap would be far more than the total
  // allowance, so the total is the binding constraint. That bound is what
  // stops an unconfirmed submission being free storage.
  const worstCase = Math.min(MAX_FILES_PER_SUBMISSION * MAX_FILE_BYTES, MAX_TOTAL_BYTES);
  assert.equal(worstCase, MAX_TOTAL_BYTES);
});

test('video gets a bigger allowance than photos, and both are enforced per kind', () => {
  assert.ok(MAX_VIDEO_BYTES > MAX_IMAGE_BYTES);
  assert.equal(maxBytesFor('image/jpeg'), MAX_IMAGE_BYTES);
  assert.equal(maxBytesFor('image/heic'), MAX_IMAGE_BYTES);
  assert.equal(maxBytesFor('video/mp4'), MAX_VIDEO_BYTES);
});

test('each kind gets its own size cap', () => {
  assert.equal(maxBytesFor('audio/mpeg'), MAX_AUDIO_BYTES);
  assert.equal(maxBytesFor('application/pdf'), MAX_DOCUMENT_BYTES);
  assert.equal(kindFor('audio/mpeg'), 'audio');
  assert.equal(kindFor('application/pdf'), 'document');
  // A document is capped by pages as well as bytes: a small PDF can still
  // be nine hundred pages, every one of which becomes an image.
  assert.ok(MAX_DOCUMENT_PAGES > 0 && MAX_DOCUMENT_PAGES <= 200);
});

test('a video-sized photo is refused by the photo cap', () => {
  // The bug this guards against: one global cap letting a 150 MB "photo"
  // through because video needs the headroom.
  assert.ok(MAX_IMAGE_BYTES < MAX_VIDEO_BYTES);
  assert.equal(kindFor('image/heic'), 'image');
  assert.equal(kindFor('video/quicktime'), 'video');
  // A type the code does not handle at all has no kind, which is what
  // every caller checks before doing anything else with it.
  assert.equal(kindFor('image/svg+xml'), null);
});

/* ------------------------------------------------------------------ */
group('upload outcomes');

test('a refusal is shown to the reporter; a withdrawal is not', () => {
  // The bug: 'rejected' meant both "they removed it" and "we turned it
  // away", so hiding withdrawals hid refusals too and a reporter whose
  // file was refused was told nothing at all.
  assert.equal(isExcludedFromReport('rejected'), true);
  assert.equal(isExcludedFromReport('infected'), true);
  assert.equal(isExcludedFromReport('unreadable'), true);
  assert.equal(isExcludedFromReport('withdrawn'), false);
  assert.equal(isExcludedFromReport('expired'), false);
  assert.equal(isExcludedFromReport('clean'), false);
});

test('a file still being checked is named rather than dropped silently', () => {
  // Confirming while the worker is mid-scan leaves the file out of the
  // report. The reporter has to be told, or evidence vanishes with no
  // explanation.
  assert.equal(isExcludedFromReport('pending'), true);
  assert.equal(isExcludedFromReport('uploaded'), true);
  assert.equal(isExcludedFromReport('processing'), true);
});

test('only our own refusals become a moderator log entry', () => {
  // A slot the reporter withdrew, or one that aged out, is not something a
  // moderator needs to see — and writing those would bury the real ones.
  assert.equal(isRefused('rejected'), true);
  assert.equal(isRefused('infected'), true);
  assert.equal(isRefused('unreadable'), true);
  assert.equal(isRefused('withdrawn'), false);
  assert.equal(isRefused('expired'), false);
  assert.equal(isRefused('pending'), false);
});

test('every refused status is also an excluded one', () => {
  // Anything worth logging to a moderator must also have been named to the
  // reporter. If these two ever disagree, one audience is being kept in
  // the dark about a file the other can see.
  for (const st of REFUSED_STATUSES) assert.equal(isExcludedFromReport(st), true);
});

group('verification — rebuilding a fingerprint from a stored row');

// A stored row, shaped the way pg hands it back: received_at as a Date,
// corrects_id as a string (bigint), answers as parsed JSON, the logbook's
// slug from the join. Getting any of those conversions wrong produces "does
// not verify" for a report that is perfectly intact — the worst possible
// failure for this page, because it accuses the archive of something untrue.
function storedRow(over) {
  return {
    id: 42,
    public_ref: 'RL-ABC123-XYZ789',
    received_at: new Date('2026-08-26T10:00:00.000Z'),
    thread_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    corrects_id: null,
    recipe: 1,
    logbook_id: '3',
    logbook_slug: 'election-day',
    answers: { outcome: 'Something went wrong', state: 'Ohio', what: ['Long lines or wait times'] },
    third_party: null,
    may_publish: true,
    may_publish_digest: DIGEST,
    ...over,
  };
}

test('a stored row rebuilds to exactly what was hashed', () => {
  const built = immutableFieldsFor(storedRow(), null);
  assert.equal(built.logbook, 'election-day');
  assert.equal(built.received_at, '2026-08-26T10:00:00.000Z');
  assert.deepEqual(built.answers, storedRow().answers);
  assert.ok(!('recipe' in built));
});

test('a row with no answers rebuilds with no answers key at all', () => {
  // NULL in the column, absent in the object — never `answers: null`.
  assert.ok(!('answers' in immutableFieldsFor(storedRow({ answers: null }), null)));
  assert.ok(!('answers' in immutableFieldsFor(storedRow({ answers: {} }), null)));
});

test('a declined publication answer is rebuilt as false, not dropped', () => {
  const built = immutableFieldsFor(storedRow({ may_publish: false }), null);
  assert.equal(built.may_publish, false);
  assert.equal(built.may_publish_digest, DIGEST);
});

test('a bigint corrects_id is compared as a number, not a string', () => {
  const built = immutableFieldsFor(storedRow({ corrects_id: '17' }), null);
  assert.strictEqual(built.corrects_id, 17);
});

test('rebuilding reproduces the hash the app would have written', () => {
  // The real assertion: what verify.js rebuilds and what reportCore.js
  // hashes at insert time are the same object. If these ever diverge,
  // every report starts failing verification at once.
  const row = storedRow();
  const asWritten = buildImmutableFields({
    publicRef: row.public_ref,
    receivedAt: row.received_at.toISOString(),
    threadId: row.thread_id,
    correctsId: null,
    fields: normalizeReportFields({
      logbook: row.logbook_slug, answers: row.answers,
      may_publish: true, may_publish_digest: DIGEST,
    }),
  });
  assert.equal(contentHash(immutableFieldsFor(row, null)), contentHash(asWritten));
});

test('an attachment manifest is part of what gets rebuilt', () => {
  const manifest = [{ ordinal: 0, sha256: 'a'.repeat(64), byte_size: 10, media_type: 'image/jpeg' }];
  assert.notEqual(
    contentHash(immutableFieldsFor(storedRow(), manifest)),
    contentHash(immutableFieldsFor(storedRow(), null)),
  );
});

test('editing any stored field changes the rebuilt fingerprint', () => {
  // What makes the whole page mean anything.
  const base = contentHash(immutableFieldsFor(storedRow(), null));
  for (const edit of [
    { answers: { ...storedRow().answers, state: 'Indiana' } },
    { answers: { ...storedRow().answers, what: [] } },
    { logbook_slug: 'another-logbook' },
    { may_publish: false },
    { public_ref: 'RL-ABC123-XYZ780' },
  ]) {
    assert.notEqual(contentHash(immutableFieldsFor(storedRow(edit), null)), base);
  }
});

/* ------------------------------------------------------------------ */
group('access log — who may see what');

test('a reason has to say something', () => {
  // A reason that is demanded but never checked becomes "." within a week,
  // and then the whole page is theatre.
  assert.ok(validateReason(''));
  assert.ok(validateReason('   '));
  assert.ok(validateReason('.'));
  assert.ok(validateReason('checking'));
  assert.equal(validateReason('Matching against an earlier report.'), null);
});

test('an over-long reason is refused rather than silently cut', () => {
  // Truncating would put a half sentence in front of the reporter and
  // attribute it to the moderator.
  assert.ok(validateReason('x'.repeat(MAX_REASON + 1)));
  assert.equal(validateReason('x'.repeat(MAX_REASON)), null);
});

test('reporters are shown only the two kinds that are about their data', () => {
  assert.ok(REPORTER_VISIBLE_KINDS.includes(KINDS.IDENTITY));
  assert.ok(REPORTER_VISIBLE_KINDS.includes(KINDS.ORIGINAL));
  // A moderator previewing the cleaned copy is workflow, not a disclosure
  // of anything the reporter gave us — showing it would bury the two that
  // matter under noise.
  assert.ok(!REPORTER_VISIBLE_KINDS.includes(KINDS.PREVIEW));
  // And a read of the audit log is about staff, not about any reporter.
  assert.ok(!REPORTER_VISIBLE_KINDS.includes(KINDS.AUDIT));
});

test('the reporter query never selects the staff email at all', () => {
  // Not fetched, rather than fetched and dropped before sending. A column
  // that is never read cannot be leaked by a later change to how this is
  // serialized, and the cost of that mistake is a volunteer's name in
  // front of someone angry about a decision.
  const src = fs.readFileSync(new URL('../src/accessLog.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function accessesForThreads'));
  assert.ok(!fn.includes('staff_email'));
});

group('severity — a moderator\u2019s judgement, never the reporter\u2019s answer');

test('there is no severity level meaning "no severity"', () => {
  // An unrated report has no severity at all — there is no fifth level for
  // a moderator to pick by accident.
  assert.deepEqual(SEVERITIES, ['note', 'irregularity', 'serious', 'systemic']);
});

test('severity is never part of a report\'s seal', () => {
  // It is a moderator's mutable judgement in report_heads, beside veracity.
  const built = buildImmutableFields({ ...args });
  assert.ok(!('severity' in built));
  assert.ok(!('severity' in normalizeReportFields({ logbook: 'x', severity: 'serious', may_publish: true, may_publish_digest: DIGEST })));
});

group('third-party intake — provenance that costs the archive nothing');

// The whole risk of adding organizations to a sealed archive is here: if
// these keys were written unconditionally, every report ever filed would
// change fingerprint at once. They are conditional, and this group is what
// says so out loud.
const directBody = {
  logbook: 'election-day',
  answers: { outcome: 'Something went wrong', state: 'Ohio' },
  may_publish: true,
  may_publish_digest: DIGEST,
};
const coordinatorBody = {
  ...directBody,
  third_party: true,
  filed_via: 'Indivisible Abroad Munich',
  intake_method: 'paper',
  attested_at: '2026-11-03T21:00:00.000Z',
  collected_on: '2026-11-03',
};

test('a report somebody files for themselves is untouched by all of this', () => {
  // The load-bearing assertion of the entire feature. If this ever fails,
  // every report in the archive has stopped verifying.
  const f = normalizeReportFields(directBody);
  for (const key of ['third_party', 'filed_via', 'intake_method', 'attested_at', 'collected_on']) {
    assert.ok(!(key in f), `a direct report must not carry ${key}`);
  }
});

test('a coordinator-filed report carries its provenance inside the seal', () => {
  const f = normalizeReportFields(coordinatorBody);
  assert.equal(f.third_party, true);
  assert.equal(f.filed_via, 'Indivisible Abroad Munich');
  assert.equal(f.intake_method, 'paper');
  assert.equal(f.attested_at, '2026-11-03T21:00:00.000Z');
});

test('provenance changes the fingerprint, which is the point of sealing it', () => {
  // If these two hashed alike, the organization named on a public report
  // would be decoration rather than something the seal covers.
  assert.notEqual(
    contentHash(buildImmutableFields({ ...args, fields: normalizeReportFields(directBody) })),
    contentHash(buildImmutableFields({ ...args, fields: normalizeReportFields(coordinatorBody) })),
  );
});

test('half a provenance record is no provenance record', () => {
  // A claim to have been filed via an organization, with no attestation
  // and no intake method, is worse than none: it reads as complete. All
  // three or nothing.
  const partial = normalizeReportFields({
    ...directBody, third_party: true, filed_via: 'Indivisible Abroad Munich',
  });
  assert.ok(!('third_party' in partial));
  assert.ok(!('filed_via' in partial));
});

test('an invented intake method is dropped, not stored', () => {
  const f = normalizeReportFields({ ...coordinatorBody, intake_method: 'telepathy' });
  assert.ok(!('third_party' in f));
});

test('the coordinator is never named in the sealed object', () => {
  // Who typed it in is Tier B, like any other reporter identity. The
  // public record says which organization an account came through and
  // stops there.
  const f = normalizeReportFields({ ...coordinatorBody, coordinator_email: 'someone@example.org' });
  assert.ok(!JSON.stringify(f).includes('someone@example.org'));
});

test('a stored third-party row rebuilds to what was hashed', () => {
  const built = immutableFieldsFor(storedRow({
    third_party: true,
    filed_via: 'Indivisible Abroad Munich',
    intake_method: 'paper',
    attested_at: new Date('2026-11-03T21:00:00.000Z'),
    collected_on: new Date(Date.UTC(2026, 10, 3)),
  }), null);
  assert.equal(built.third_party, true);
  assert.equal(built.filed_via, 'Indivisible Abroad Munich');
  assert.equal(built.attested_at, '2026-11-03T21:00:00.000Z');
  assert.equal(built.collected_on, '2026-11-03');
});

test('a stored direct row rebuilds with no provenance keys at all', () => {
  const built = immutableFieldsFor(storedRow(), null);
  for (const key of ['third_party', 'filed_via', 'intake_method', 'attested_at', 'collected_on']) {
    assert.ok(!(key in built), `rebuilding a direct report must not add ${key}`);
  }
});

/* ------------------------------------------------------------------ */
group('roles — the two axes, and the guard that holds the ceiling up');

test('an Access Manager cannot make another Access Manager', () => {
  // The rule the whole delegation design rests on. If Access Managers
  // could mint each other the role would replicate, and the ceiling would
  // be gone.
  assert.ok(!canGrantSystemRole('access_manager', 'access_manager'));
  assert.ok(canGrantSystemRole('admin', 'access_manager'));
});

test('an Access Manager can make and unmake Moderators', () => {
  assert.ok(canGrantSystemRole('access_manager', 'moderator'));
  assert.ok(canGrantSystemRole('access_manager', 'user'));
});

test('a Moderator grants nothing', () => {
  assert.ok(!canGrantSystemRole('moderator', 'moderator'));
  assert.ok(!canGrantSystemRole('moderator', 'user'));
  assert.ok(!canGrantSystemRole('user', 'moderator'));
});

test('only the owner changes an admin', () => {
  // An admin demoting an admin used to be refused outright, because doing
  // it to the last one locked everyone out. The owner can always mint
  // another, so the lockout that rule guarded against cannot happen.
  assert.ok(!canChangeSubject('admin', 'admin'));
  assert.ok(!canChangeSubject('access_manager', 'admin'));
  assert.ok(canChangeSubject('owner', 'admin'));
  // And an Access Manager cannot touch a peer.
  assert.ok(!canChangeSubject('access_manager', 'access_manager'));
  assert.ok(canChangeSubject('admin', 'access_manager'));
  assert.ok(canChangeSubject('owner', 'access_manager'));
});

test('nobody changes the owner through the app, including the owner', () => {
  // The seat moves by handover in src/ownership.js, which needs both
  // parties. A one-sided transfer to a wrong address is unrecoverable.
  for (const actor of SYSTEM_ROLES) {
    assert.ok(!canChangeSubject(actor, 'owner'), `${actor} must not change the owner`);
  }
});

test('the owner is the only role that can appoint an admin', () => {
  assert.ok(canGrantSystemRole('owner', 'admin'));
  assert.ok(!canGrantSystemRole('admin', 'admin'));
  assert.ok(!canGrantSystemRole('access_manager', 'admin'));
  assert.ok(!canGrantSystemRole('moderator', 'admin'));
});

test('the owner seat is ungrantable, by anybody, including the owner', () => {
  // THE LOAD-BEARING ONE for the rank above admin. If the top role could
  // hand itself out, one grant would eventually become every grant, which
  // is the problem the Access Manager ceiling exists to prevent one rung
  // down. Reads the real table rather than restating it.
  for (const [actor, grantable] of Object.entries(MAY_GRANT)) {
    assert.ok(!grantable.includes('owner'), `${actor} must not be able to grant owner`);
  }
  assert.ok(!canGrantSystemRole('owner', 'owner'));
});

test('owner outranks admin, and nothing else outranks anything', () => {
  assert.ok(roleSatisfies('owner', 'admin'));
  assert.ok(roleSatisfies('owner', 'owner'));
  assert.ok(hasAdminAuthority('owner'));
  assert.ok(hasAdminAuthority('admin'));
  // NOT a general ladder. Every route that wants both already says both,
  // and inventing a hierarchy here would silently widen those routes.
  assert.ok(!roleSatisfies('admin', 'owner'));
  assert.ok(!roleSatisfies('admin', 'moderator'));
  assert.ok(!roleSatisfies('access_manager', 'moderator'));
  assert.ok(!hasAdminAuthority('access_manager'));
  assert.ok(!hasAdminAuthority(undefined));
});

test('every system role is one the database will accept', () => {
  // Reads the CHECK constraint out of the migrations instead of restating
  // the list. The previous version of this test was a second copy of the
  // array, so it asserted that two hand-typed lists matched each other and
  // would have gone red for a role the database was perfectly happy with.
  const dir = new URL('../migrations/', import.meta.url);
  const sql = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => fs.readFileSync(new URL(f, dir), 'utf8')).join('\n');
  const defs = [...sql.matchAll(/users_role_check\s+CHECK\s*\(\s*\n?\s*role\s*=\s*ANY\s*\(ARRAY\[([^\]]+)\]/g)];
  assert.ok(defs.length, 'no users_role_check found in the migrations');
  const accepted = defs[defs.length - 1][1]
    .split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
  assert.deepEqual([...SYSTEM_ROLES].sort(), accepted.sort());
});

/* ------------------------------------------------------------------ */
group('media cache');

const os = await import('node:os');
const fsm = await import('node:fs');
const pathm = await import('node:path');

const cacheDir = pathm.join(os.tmpdir(), `edr-cache-test-${crypto.randomBytes(6).toString('hex')}`);
process.env.MEDIA_CACHE_DIR = cacheDir;
const cache = await import('../src/mediaCache.js');

test('reports its configuration', () => {
  const st = cache.cacheStatus();
  assert.equal(st.enabled, true);
  assert.equal(st.dir, cacheDir);
});

// The shipped systemd units declare CacheDirectory=reportlog and set no
// MEDIA_CACHE_DIR, so this is the path a real deployment takes. It was not
// covered, and the module fell through to the temp dir — which under
// PrivateTmp=true is destroyed every invocation and shared with nobody, so
// the cache silently did nothing on every systemd-run instance.
test('systemd\'s CACHE_DIRECTORY is used when MEDIA_CACHE_DIR is not set', async () => {
  const saved = process.env.MEDIA_CACHE_DIR;
  const systemdDir = pathm.join(os.tmpdir(), `edr-cache-systemd-${crypto.randomBytes(6).toString('hex')}`);
  delete process.env.MEDIA_CACHE_DIR;
  process.env.CACHE_DIRECTORY = systemdDir;
  try {
    const fresh = await import('../src/mediaCache.js?systemd');
    assert.equal(fresh.cacheStatus().dir, systemdDir);
  } finally {
    delete process.env.CACHE_DIRECTORY;
    if (saved === undefined) delete process.env.MEDIA_CACHE_DIR;
    else process.env.MEDIA_CACHE_DIR = saved;
  }
});

test('an explicit MEDIA_CACHE_DIR still wins over CACHE_DIRECTORY', async () => {
  const explicit = pathm.join(os.tmpdir(), `edr-cache-explicit-${crypto.randomBytes(6).toString('hex')}`);
  const saved = process.env.MEDIA_CACHE_DIR;
  process.env.MEDIA_CACHE_DIR = explicit;
  process.env.CACHE_DIRECTORY = pathm.join(os.tmpdir(), 'should-not-be-used');
  try {
    const fresh = await import('../src/mediaCache.js?explicit');
    assert.equal(fresh.cacheStatus().dir, explicit);
  } finally {
    delete process.env.CACHE_DIRECTORY;
    if (saved === undefined) delete process.env.MEDIA_CACHE_DIR;
    else process.env.MEDIA_CACHE_DIR = saved;
  }
});

test('forgetting something that was never cached is safe', async () => {
  await cache.forget('rendition/does-not-exist');
  await cache.forget(null);
});

test('cache filenames are hashes, never the storage key', () => {
  fsm.mkdirSync(cacheDir, { recursive: true });
  // The key is server-generated, but it still becomes a path — so the
  // filename must be a fixed-width hash and never carry the key through.
  const key = 'rendition/../../etc/passwd';
  fsm.writeFileSync(pathm.join(cacheDir, crypto.createHash('sha256').update(key).digest('hex')), 'x');
  const names = fsm.readdirSync(cacheDir);
  assert.equal(names.length, 1);
  assert.match(names[0], /^[0-9a-f]{64}$/);
  assert.ok(!names[0].includes('passwd'));
  assert.ok(!names[0].includes('..'));
  fsm.rmSync(cacheDir, { recursive: true, force: true });
});


group('volunteering is a list now');

// The volunteer form, its catalogue, its confirm-your-address flow and its
// admin tab were removed when it moved onto a list (migration 047).
// What has to stay true is that every box still HAS the form,
// with the reach the old one had, and that nothing is left calling the old
// code.

const m047 = fs.readFileSync(new URL('../migrations/047_open_doors_and_list_mail.sql', import.meta.url), 'utf8');

test('migration 047 creates the volunteer list on every box, from its own roles', () => {
  assert.match(m047, /INSERT INTO lists \(slug, title, blurb, visibility, outside_access, notify\)\s*VALUES \('volunteer'/);
  // Listed, open without the password and linked from the password page,
  // and mailed to the admin address — what the old form did.
  assert.match(m047, /'listed', 'door', true\)/);
  assert.match(m047, /FROM volunteer_kinds k LEFT JOIN volunteer_groups g/);
  assert.match(m047, /IF EXISTS \(SELECT 1 FROM lists WHERE slug = 'volunteer'\)/,
    'an operator\'s own list at that address must not be overwritten');
});

test('it asks a name, the roles and a note — and the roles are counted, the words are not kept', () => {
  assert.match(m047, /'name', 'short_text'[^)]*'transient'\)/);
  assert.match(m047, /'roles', 'choice_many'[\s\S]*?'durable'\)/);
  assert.match(m047, /'note', 'long_text'[^)]*'transient'\)/);
});

test('migration 048 makes the forms that reach the site always ask for an address', () => {
  const m = fs.readFileSync(new URL('../migrations/048_list_email_mode.sql', import.meta.url), 'utf8');
  assert.match(m, /CHECK \(email_mode IN \('auto', 'required'\)\)/);
  assert.match(m, /UPDATE lists SET email_mode = 'required' WHERE slug IN \('volunteer', 'contact'\)/);
  assert.match(fs.readFileSync(new URL('../templates/lists/contact.json', import.meta.url), 'utf8'), /"ask_email": "always"/);
});

test('it deletes no table: the old ones stay, unread', () => {
  const statements = m047.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.ok(!/\bDROP\b/i.test(statements));
});

test('nothing is left calling the old volunteer code', () => {
  for (const gone of ['src/volunteer.js', 'src/volunteerCatalogue.js', 'src/routes/volunteer.js', 'public/js/volunteer-form.js']) {
    assert.ok(!fs.existsSync(new URL(`../${gone}`, import.meta.url)), `${gone} is back`);
  }
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.ok(!/\/api\/volunteer|\/api\/involve/.test(server), 'the old volunteer API is still mounted');
});

test('the old addresses and the links in old emails still land on the form', () => {
  const routes = stripComments(fs.readFileSync(new URL('../public/js/routes.js', import.meta.url), 'utf8'));
  const re = routes.match(/function isOldVolunteerPath\(p\)\{\s*return (\/.*\/)\.test\(p\);/);
  assert.ok(re, 'isOldVolunteerPath is gone');
  const rx = eval(re[1]); // the literal from the source, so the test reads what ships
  for (const p of ['/volunteer', '/involve', '/volunteer/confirm/abc', '/involve/confirm/abc']) assert.ok(rx.test(p), p);
  assert.ok(!rx.test('/volunteers'));
  assert.match(routes, /replaceState\(\{\},'','\/list\/volunteer'\)/);
});

/* ------------------------------------------------------------------ */
group('Every async route handler is wrapped');

// This group exists because the rule it enforces fails by OMISSION. Express 4
// does not catch a rejected promise from an async handler: Node terminates
// the process, the client gets a dropped connection with no status code, and
// nothing is written down. Miss one route and the app still crashes — but
// silently, and possibly not for weeks.
//
// A reviewer cannot reliably spot the one handler out of eighty-odd that was
// added without the wrapper. This can, every time the suite runs.

const ROUTE_DIR = new URL('../src/routes/', import.meta.url);
const routeFiles = fs.readdirSync(ROUTE_DIR).filter((f) => f.endsWith('.js'));

test('there are route files to check', () => {
  // Guards against the whole group quietly passing because a rename made the
  // directory unreadable — a green suite that checked nothing is worse than
  // a red one.
  assert.ok(routeFiles.length > 5, `expected route files, found ${routeFiles.length}`);
});

for (const f of routeFiles) {
  const src = fs.readFileSync(new URL(f, ROUTE_DIR), 'utf8');
  const handlers = [...src.matchAll(/async \(req, res/g)];
  if (!handlers.length) continue;

  test(`${f}: every async handler is wrapped in asyncRoute`, () => {
    for (const m of handlers) {
      const before = src.slice(0, m.index);
      const line = before.split('\n').length;
      assert.ok(
        before.endsWith('asyncRoute('),
        `${f}:${line} has an async handler that is not wrapped in asyncRoute(). `
        + 'Unwrapped, a rejection here kills the process and the client sees a dropped connection.',
      );
    }
  });

  test(`${f}: imports asyncRoute`, () => {
    assert.match(src, /import \{ asyncRoute \} from '\.\.\/asyncRoute\.js';/);
  });
}

// Middleware outside src/routes/ is mounted in server.js rather than on a
// router, so it needs the same wrapper in a different place. attachUser and
// requireSiteAccess are the two that matter most: both are async, both query
// the database, and both run on requests that never reach a route at all.
const serverSrc = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const srcDir = new URL('../src/', import.meta.url);
const asyncMiddleware = [];
// Both directories: attachUser is exported from src/routes/auth.js and
// mounted globally, so a scan of src/ alone misses it — which it did, on the
// first version of this check.
for (const [base, files] of [
  [srcDir, fs.readdirSync(srcDir).filter((f) => f.endsWith('.js'))],
  [ROUTE_DIR, routeFiles],
]) {
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, base), 'utf8');
    for (const m of src.matchAll(/export async function (\w+)\(req, res, next\)/g)) {
      asyncMiddleware.push(m[1]);
    }
  }
}

test('the known async middleware are all found by the scan', () => {
  // Named rather than counted. A regex that silently matches nothing leaves
  // a green suite that checked nothing, which is how attachUser escaped the
  // first version of this check.
  for (const name of ['attachUser', 'requireSiteAccess']) {
    assert.ok(asyncMiddleware.includes(name), `${name} was not found by the middleware scan`);
  }
});

for (const name of asyncMiddleware) {
  test(`${name} is wrapped where server.js mounts it`, () => {
    if (!new RegExp(`\\b${name}\\b`).test(serverSrc.replace(/^import .*$/gm, ''))) return; // not mounted here
    assert.ok(
      serverSrc.includes(`asyncRoute(${name})`),
      `server.js mounts ${name} without asyncRoute(). It is async and runs on every request that reaches it.`,
    );
  });
}

test('server.js installs the request log, the error handler and the process handlers', () => {
  assert.match(serverSrc, /app\.use\(requestLog\)/);
  assert.match(serverSrc, /app\.use\(errorHandler\)/);
  assert.match(serverSrc, /installProcessHandlers\(\)/);
});

test('the error handler is mounted after every route', () => {
  // Express picks middleware in mount order, so an error handler registered
  // before the routes never sees anything they throw.
  assert.ok(
    serverSrc.indexOf('app.use(errorHandler)') > serverSrc.lastIndexOf("app.use('/api/stats'"),
    'app.use(errorHandler) must come after the routes it is meant to catch',
  );
});

/* ------------------------------------------------------------------ */
group('The request log gives nothing away');

test('a digest does not contain the value it stands for', () => {
  const secret = 'a'.repeat(48);
  const t = tag(secret);
  assert.equal(t.length, 8);
  assert.ok(!secret.includes(t), 'the digest must not be a slice of the token');
  assert.notEqual(t, secret.slice(0, 8));
});

test('the same value always gets the same digest', () => {
  // Correlation is the entire point: two log lines about one upload have to
  // be recognisable as one upload.
  assert.equal(tag('slot-token-value'), tag('slot-token-value'));
  assert.notEqual(tag('one'), tag('another'));
});

test('an empty value gets no digest rather than a digest of nothing', () => {
  assert.equal(tag(''), null);
  assert.equal(tag(undefined), null);
});

/* ------------------------------------------------------------------ */
group('Publication permission: asked of every report, and sealed with its wording');

// Every report is asked. `false` (asked, declined) is a real answer and is
// sealed as false; there is no "never asked" any more, because there is no
// way to file a report that was not asked.

const permissionBase = { logbook: 'election-day', answers: { state: 'Ohio' } };
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

function permissionHash(over) {
  return contentHash(buildImmutableFields({
    publicRef: 'RL-000002', receivedAt: '2026-11-03T10:00:00.000Z',
    threadId: '22222222-2222-2222-2222-222222222222', correctsId: null,
    fields: normalizeReportFields({ ...permissionBase, ...over }),
    attachmentManifest: null,
  }));
}

test('permitted and declined are different fingerprints', () => {
  assert.notEqual(
    permissionHash({ may_publish: true, may_publish_digest: DIGEST_A }),
    permissionHash({ may_publish: false, may_publish_digest: DIGEST_A }),
  );
});

test('the digest is part of what is sealed', () => {
  // Otherwise the wording could change under an old answer without trace.
  assert.notEqual(
    permissionHash({ may_publish: true, may_publish_digest: DIGEST_A }),
    permissionHash({ may_publish: true, may_publish_digest: DIGEST_B }),
  );
});

test('the string forms a form posts are read as booleans', () => {
  assert.equal(
    permissionHash({ may_publish: 'true', may_publish_digest: DIGEST_A }),
    permissionHash({ may_publish: true, may_publish_digest: DIGEST_A }),
  );
  assert.equal(
    permissionHash({ may_publish: 'false', may_publish_digest: DIGEST_A }),
    permissionHash({ may_publish: false, may_publish_digest: DIGEST_A }),
  );
});

test('a malformed digest is refused, not sealed', () => {
  for (const bad of ['', 'nope', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
    assert.throws(() => normalizeReportFields({ ...permissionBase, may_publish: true, may_publish_digest: bad }),
      undefined, `digest ${JSON.stringify(bad)} should not have been accepted`);
  }
});

test('verify.js rebuilds both answers exactly as reportCore wrote them', () => {
  const meta = {
    publicRef: 'RL-000003', receivedAt: '2026-11-03T10:00:00.000Z',
    threadId: '33333333-3333-3333-3333-333333333333', correctsId: null,
  };
  for (const value of [true, false]) {
    const written = buildImmutableFields({
      ...meta,
      fields: normalizeReportFields({ ...permissionBase, may_publish: value, may_publish_digest: DIGEST_A }),
      attachmentManifest: null,
    });
    const rebuilt = immutableFieldsFor({
      public_ref: meta.publicRef,
      received_at: new Date(meta.receivedAt),
      thread_id: meta.threadId,
      corrects_id: null,
      recipe: 1,
      logbook_slug: 'election-day',
      answers: { state: 'Ohio' },
      may_publish: value,
      may_publish_digest: DIGEST_A,
    }, null);
    assert.equal(canonicalize(rebuilt), canonicalize(written), `${value} did not round-trip byte for byte`);
  }
});

test('a null in the object is not the same as an absent key, which is why NULL must omit', () => {
  // The rule the whole archive runs on, for every optional key.
  assert.notEqual(canonicalize({ a: 1 }), canonicalize({ a: 1, answers: null }));
});

/* ------------------------------------------------------------------ */
group('Exactly one owner, always — and never none');

test('four separate mechanisms hold it, and the invariant is their conjunction', () => {
  // The rule: an instance has ONLY ONE OWNER. Nobody else can mint
  // admins or shut the server down. It is higher up than admin.
  //
  // That is already how the code behaves, so the job is not to build it but
  // to stop it being dismantled one piece at a time. The database index
  // prevents TWO owners. It says nothing about ZERO — and an ownerless
  // deployment is a state the design rules out rather than resolves. Nothing fails loudly today if any
  // one of these four goes.
  const roles = fs.readFileSync(new URL('../src/roles.js', import.meta.url), 'utf8');
  const own = fs.readFileSync(new URL('../src/ownership.js', import.meta.url), 'utf8');
  const mig = fs.readFileSync(new URL('../migrations/023_owner_role.sql', import.meta.url), 'utf8');

  // 1 · NEVER TWO. A partial unique index rather than a CHECK, because a
  //     CHECK cannot see other rows.
  assert.match(mig, /CREATE UNIQUE INDEX[^;]*users_single_owner_idx[^;]*WHERE role = 'owner'/s);

  // 2 · NEVER DEMOTED. canChangeSubject refuses an owner as the SUBJECT, so
  //     no actor and no argument can take the seat off somebody.
  assert.match(roles, /if \(subjectRole === 'owner'\) return false;/);

  // 3 · NEVER UNGRANTABLE-BY-ACCIDENT. 'owner' appears in no row of
  //     MAY_GRANT, its own included, so setSystemRole cannot produce one.
  const grant = roles.slice(roles.indexOf('export const MAY_GRANT'));
  const table = grant.slice(0, grant.indexOf('};'));
  assert.ok(!/:\s*\[[^\]]*'owner'/.test(table),
    "'owner' is grantable from some row of MAY_GRANT, so the seat can be minted");
  // And admin must not be able to mint an admin, or the ceiling is one rung
  // lower than designed.
  assert.match(table, /admin: \['user', 'moderator', 'access_manager'\]/);

  // 4 · NEVER REMOVED. No path deletes a user, so the seat cannot be
  //     vacated by deleting whoever holds it.
  for (const f of fs.readdirSync(new URL('../src', import.meta.url))) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.ok(!/DELETE\s+FROM\s+users\b/i.test(src),
      `src/${f} deletes a user row, which can empty the owner seat`);
  }
  for (const f of fs.readdirSync(new URL('../src/routes', import.meta.url))) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(new URL(`../src/routes/${f}`, import.meta.url), 'utf8');
    assert.ok(!/DELETE\s+FROM\s+users\b/i.test(src),
      `src/routes/${f} deletes a user row, which can empty the owner seat`);
  }

  // AND THE HANDOVER LEAVES NO GAP. Both halves in one transaction, under a
  // table lock, with the outgoing seat re-read inside it rather than trusted
  // from the proposal. Demoting first and failing would be the one way to
  // reach zero owners.
  const accept = own.slice(own.indexOf('export async function acceptTransfer'));
  const body = accept.slice(0, accept.indexOf('\n}\n'));
  assert.match(body, /LOCK TABLE users/, 'the handover does not lock the table');
  assert.match(body, /SELECT email FROM users WHERE role = 'owner'/,
    'the handover trusts the proposal instead of re-reading the seat');
  // The demote and the promote, by the statements that do them, and nothing
  // committing between the two — demoting first and then failing is the one
  // way to reach zero owners.
  const demote = body.indexOf("UPDATE users SET role = 'admin'");
  const promote = body.indexOf('INSERT INTO users');
  assert.ok(demote > 0 && promote > 0, 'the handover no longer demotes and promotes');
  assert.ok(demote < promote, 'the promote happens before the demote');
  assert.ok(!body.slice(demote, promote).includes('COMMIT'),
    'something commits between the two halves of the handover, leaving no owner');
  assert.match(body, /COMMIT/, 'the handover never commits');
});

test('the owner seat is the imprint entity, which the software does not enforce', () => {
  // The owner seat IS the legal entity, at least at launch. That is a fact about the organisation, not a rule the
  // code can check — there is nothing in a deployment that knows what its
  // own legal entity is, and inventing a field for it would be a
  // `deployment_type` by another name (docs/reference.md §21.5).
  //
  // So this asserts the ABSENCE: no code reads an imprint to decide
  // anything about roles, and no role decides anything about the imprint.
  const roles = fs.readFileSync(new URL('../src/roles.js', import.meta.url), 'utf8');
  assert.ok(!/imprint|legalEntity|legal_entity/i.test(roles),
    'roles.js reaches for the legal notice, which it cannot know');
  const legal = fs.readFileSync(new URL('../src/routes/legal.js', import.meta.url), 'utf8');
  assert.ok(!/MAY_GRANT|setSystemRole/.test(legal),
    'the legal notice route reaches into the role system');
});

group('The confirmation link and its staged uploads expire together');

test('the two TTLs are the same number, because they are a pair', async () => {
  // A staged upload outliving its submission is an orphan. A submission
  // outliving its uploads is a reporter confirming a report whose files have
  // silently gone. Neither is a state anybody chose, and both are what a
  // change to one of these alone produces.
  const sub = fs.readFileSync(new URL('../src/submissionTokens.js', import.meta.url), 'utf8');
  const att = fs.readFileSync(new URL('../src/attachments.js', import.meta.url), 'utf8');
  const one = sub.match(/const TOKEN_TTL_MS = (\d+) \* 60 \* 60 \* 1000/);
  const two = att.match(/const SLOT_TTL_MS = (\d+) \* 60 \* 60 \* 1000/);
  assert.ok(one && two, 'one of the two TTLs is no longer written as hours');
  assert.equal(one[1], two[1],
    `the confirmation link lasts ${one[1]}h and its uploads ${two[1]}h — they must match`);
  assert.equal(one[1], '24', 'the confirmation window is 24 hours by decision');
});

test('and each says why, and what it costs', () => {
  // The number is a judgement rather than a fact, so the reasoning travels
  // with it — the Friday-night reporter is a real person and the trade was
  // made knowingly.
  const sub = fs.readFileSync(new URL('../src/submissionTokens.js', import.meta.url), 'utf8');
  assert.match(sub, /Friday night/, 'nothing records who this costs');
  assert.match(sub, /SLOT_TTL_MS/, 'nothing points at the number that must match');
  const att = fs.readFileSync(new URL('../src/attachments.js', import.meta.url), 'utf8');
  assert.match(att, /submissionTokens\.js/, 'nothing points back');
});

group('Intake hardening: nothing is worked on before Send');

test('the media worker claims RELEASED work only', () => {
  // The column is the whole mechanism: it is what let the form's Ready gate
  // go, and a worker that stopped filtering on it would quietly put the
  // transcode back in front of the reporter while every other check here
  // stayed green.
  const src = fs.readFileSync(new URL('../scripts/media-worker.js', import.meta.url), 'utf8');
  const claim = src.slice(src.indexOf("WHERE status = 'uploaded'"));
  assert.match(claim.slice(0, 200), /released_at IS NOT NULL/,
    'the worker would process staged files for drafts nobody has sent');
});

test('a filing slot is released when Send is pressed, and not before', () => {
  const att = fs.readFileSync(new URL('../src/attachments.js', import.meta.url), 'utf8');
  const fn = att.slice(att.indexOf('export async function releaseDraft'),
    att.indexOf('export const CONFIRM_WAIT_MS'));
  // Only what is still waiting. Re-stamping a slot already being worked on
  // would make released_at say something other than when Send was pressed.
  assert.match(fn, /released_at IS NULL/);
  assert.match(fn, /status IN \('pending', 'uploaded'\)/);

  // And the submit route is what calls it. Without this the column is set
  // by nothing and every file stays unprocessed for ever.
  const route = fs.readFileSync(new URL('../src/routes/reports.js', import.meta.url), 'utf8');
  assert.match(route, /releaseDraft\(b\.draft_token\)/,
    'nothing releases a draft, so no file would ever be processed');
});

test('confirming waits for a file still being prepared rather than sealing without it', () => {
  // Confirmation is the last moment the manifest can change and
  // clearedSlotsFor takes finished files only, so this is what stands where
  // the form's gate used to. Sealing instead would produce a report that
  // silently does not hold a photograph the reporter watched upload.
  const route = fs.readFileSync(new URL('../src/routes/reports.js', import.meta.url), 'utf8');
  const before = route.indexOf("status: 'preparing'");
  const create = route.indexOf('await createReportFromToken(row)');
  assert.ok(before > 0, 'nothing answers a confirmation whose files are not ready');
  assert.ok(before < create,
    'the wait has to come BEFORE the report is created, or it is too late to matter');
  assert.match(route, /inFlightSlotsFor/);
  // Bounded, or a stopped worker strands an otherwise complete report.
  assert.match(route, /CONFIRM_WAIT_MS/, 'the wait is unbounded');
});

test('nothing that hashes reads either new column', () => {
  // Same rule as src/reportPermissions.js: a value that can change must
  // never reach a fingerprint. Which address staged a file and when it was
  // released are both facts about intake, not about the report.
  for (const f of ['reportCore.js', 'verify.js', 'chainFile.js', 'snapshot.js']) {
    const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.ok(!/contact_hmac|released_at/.test(src),
      `${f} reads an intake column — a report would verify differently for it`);
  }
});

test('the staging quota is keyed on the address and skips what is already a report', () => {
  const att = fs.readFileSync(new URL('../src/attachments.js', import.meta.url), 'utf8');
  const fn = att.slice(att.indexOf('export async function createUploadSlot'),
    att.indexOf('export async function capsFor'));
  assert.match(fn, /WHERE contact_hmac = \$1/,
    'the quota is back to counting one draft, which a free draft token walks around');
  // A file that reached a report is storage the archive means to hold, and
  // counting it would lock a reporter out after their third report for good.
  assert.match(fn, /promoted_at IS NULL/);
  assert.match(fn, /expires_at > now\(\)/);
  // The digest, never the address: a staging row must hold nothing reachable.
  assert.match(fn, /hmacEmail\(address\)/);
  assert.ok(!/contact_hmac,\s*address/.test(fn), 'an address is being stored in the clear');
});

test('the form still waits for the upload, and no longer for the checking', () => {
  // DELETING THIS WAIT WAS THE TRAP THE SPEC WARNED ABOUT. Send releases
  // these slots to the worker, and a slot whose object never finished
  // arriving is one the worker marks unreadable — a file the reporter
  // watched upload and does not get.
  const src = fs.readFileSync(new URL('../public/js/form-logbook.js', import.meta.url), 'utf8');
  const busy = src.match(/var FILE_BUSY=\[([^\]]*)\]/);
  assert.ok(busy, 'FILE_BUSY is gone, so nothing says what the form waits for');
  const list = busy[1];
  assert.match(list, /'uploading'/, 'the form would send before the bytes arrive');
  assert.match(list, /'pending'/, "a PUT the server was never told finished is not done");
  assert.ok(!/'processing'/.test(list) && !/'uploaded'/.test(list),
    'the Ready gate is back: somebody is waiting for a transcode on the last card');
});

test('the address is asked before the upload cards, and only where it buys something', () => {
  const src = fs.readFileSync(new URL('../public/js/form.js', import.meta.url), 'utf8');
  const order = ['contact', 'evidence-ask', 'evidence', 'send']
    .map((id) => src.indexOf(`{id:'${id}'`));
  assert.ok(order.every((i) => i > 0), 'a card named in STEPS has gone missing');
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1] < order[i],
      'the address must be collected before a byte is staged — the quota is keyed on it');
  }
  // Only on a logbook that takes files. Asking earlier everywhere costs a
  // reporter on a logbook where it buys nothing.
  const card = src.slice(order[0], order[1]);
  assert.match(card, /when:lbTakesFiles/);

  // And the card exists in the markup, or buildCards logs and skips it.
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /data-card="contact"/);
  // ONE input, moved rather than copied: two would be two answers.
  assert.equal((html.match(/id="rEmail"/g) || []).length, 1,
    'there are two email inputs, so there are two answers to one question');
  const logbook = fs.readFileSync(new URL('../public/js/form-logbook.js', import.meta.url), 'utf8');
  assert.match(logbook, /function lbPlaceContact/);
  assert.match(logbook, /lbPlaceContact\(\);/, 'nothing ever moves the field');
});

test('the client sends the address with each slot request', () => {
  // Read from the DOM at request time rather than captured, so a correction
  // on the review card is the address the next file is counted against.
  const src = fs.readFileSync(new URL('../public/js/attachments.js', import.meta.url), 'utf8');
  assert.match(src, /email:attContactEmail\(\)/,
    'the server will refuse every slot: it requires an address while filing');
  assert.match(src, /function attContactEmail/);
});

test('both new settings are documented where an operator looks', () => {
  // THE SCALEWAY LESSON: src/email.js had the transport for weeks and
  // neither guide named the variables, so the only way to use a supported
  // feature was to read the source. A setting nobody can find is a setting
  // nobody has.
  const example = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const reference = fs.readFileSync(new URL('../docs/reference.md', import.meta.url), 'utf8');
  for (const key of ['STAGING_QUOTA_REPORTS', 'CONFIRM_WAIT_MS']) {
    assert.match(example, new RegExp(`^${key}=`, 'm'), `.env.example does not carry ${key}`);
    assert.match(reference, new RegExp(`\`${key}\``), `the reference does not name ${key}`);
  }
  // And the pairing that matters, said in both places rather than only in
  // the code where somebody tuning the first number will not see it.
  assert.match(example, /MEDIA_WORKER_STALE_MINUTES/);
  assert.match(reference, /MEDIA_WORKER_STALE_MINUTES/);
});

test('a tool the guide invokes before anything is installed says what to do without it', () => {
  // `dig` is the first command in the DNS section and it is NOT installed on
  // a fresh Debian box or on Windows. The fallback existed in both guides and
  // sat seventy lines further down, attached to a LATER dig — so a first
  // timer met "command not found" on the first thing they were told to run
  // and the answer was somewhere they had not reached yet.
  //
  // The rule is about placement, not presence: the way out has to be at the
  // FIRST use, because that is where somebody is stuck.
  for (const f of ['public/docs.html', 'INSTALL.md']) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const first = src.indexOf('dig +short NS');
    assert.ok(first > 0, `${f} no longer asks the domain for its nameservers`);
    // Everything up to the next command block or heading is "at first use".
    const near = src.slice(first, first + 900);
    assert.match(near, /command not found/,
      `${f} runs dig before saying what to do when it is not installed`);
    assert.match(near, /nslookup/, `${f} names no fallback that exists on Windows`);
    assert.match(near, /dnsutils/, `${f} does not say how to install it`);
  }
});

group('The standalone docs site');

test('it builds, and it carries the guide and nothing else', () => {
  const dir = pathm.join(os.tmpdir(), `docs-site-selftest-${process.pid}`);
  try {
    execFileSync(process.execPath, ['tools/make-docs-site.mjs', dir],
      { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' });

    // The guide is the front page: somebody handed a documentation hostname
    // must meet the guide, not a listing or a 404.
    const index = fs.readFileSync(pathm.join(dir, 'index.html'), 'utf8');
    assert.match(index, /Standing up ReportLog/);
    // And at /docs too, because that is where it lives on a deployment and
    // every link anybody has written to it says /docs.
    assert.ok(fs.existsSync(pathm.join(dir, 'docs', 'index.html')));

    for (const f of ['css/docs-page.css', 'js/docs-page.js', 'fonts/fonts.css',
      'icons/favicon-32.png', 'robots.txt']) {
      assert.ok(fs.existsSync(pathm.join(dir, f)), `${f} is missing from the built site`);
    }

    // THE WHOLE POINT OF A BUILD RATHER THAN PUBLISHING public/. The app's
    // own shell on a documentation hostname is a site that looks like a
    // ReportLog and cannot take a report.
    const shell = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const marker = (shell.match(/data-card="send"|id="rcards"/) || [])[0];
    assert.ok(marker, 'public/index.html no longer has the marker this check looks for');
    const all = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = pathm.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.html$/.test(e.name)) all.push(fs.readFileSync(full, 'utf8'));
      }
    })(dir);
    for (const html of all) {
      assert.ok(!html.includes(marker),
        'the application shell reached the docs site — it would serve a form with no server');
    }

    // The page's own markup is NOT edited by the build: same absolute paths
    // as a deployment serves, so one HTML works in both places.
    const src = fs.readFileSync(new URL('../public/docs.html', import.meta.url), 'utf8');
    assert.equal(index, src, 'the build rewrote the guide instead of copying it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('and the build refuses to ship a page whose assets it does not copy', () => {
  // A <link> added to docs.html and not to ASSETS 404s in production ONLY —
  // on a deployment the whole of public/ is served. A missing docs-page.js
  // is a guide with no copy buttons, no branching and no fill-in panel, and
  // it still renders and still looks fine. So the build fails instead.
  const src = fs.readFileSync(new URL('../tools/make-docs-site.mjs', import.meta.url), 'utf8');
  assert.match(src, /function assertComplete/);
  assert.match(src, /process\.exit\(1\)/, 'a missing asset does not fail the build');
  // And the font files come out of the stylesheet rather than a second list.
  assert.match(src, /matchAll\(\/url\\\(/, 'the font list is hand-maintained again');
});

group('The one-file install handout');

test('the handout builds, and it still carries its copy buttons', () => {
  // THE FAILURE THIS GUARD IS FOR WAS SILENT. The handout's first build
  // mangled the JavaScript on its way in and shipped a page with ZERO copy
  // buttons and one console error that named nothing — see the trap at the
  // top of tools/make-handout.mjs. So the build is run, not just read.
  const out = pathm.join(os.tmpdir(), `handout-selftest-${process.pid}.html`);
  try {
    // Exits non-zero if public/docs.html has changed shape or the page it
    // produced would reach the network, which is the other half of the job.
    execFileSync(process.execPath, ['tools/make-handout.mjs', out],
      { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' });
    const page = fs.readFileSync(out, 'utf8');
    assert.match(page, /buildCopyButtons/, 'the handout has no copy buttons');
    assert.match(page, /data-when/, 'the branching engine did not make it in');
    assert.match(page, /<style>/, 'the stylesheet was not inlined');
    assert.ok(!/(?:src|href)="\//.test(page),
      'the handout still points at a server path, so it fetches nothing it needs');
    assert.match(page, /snapshot of v/, 'nothing says this is a snapshot of a dated version');
  } finally {
    fs.rmSync(out, { force: true });
  }
});

test('and it is wired up as an npm script, not only documented', () => {
  // `npm run export-archive` was in the guide and in no package.json for
  // weeks. A command a reader can find and cannot run is worse than one
  // nobody mentioned.
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.handout, 'node tools/make-handout.mjs');
});

test('and the script says why a replacement is a function', () => {
  // The script is eight replacements; the only thing worth keeping is the
  // reason they are written the way they are. It lived in a scratchpad
  // docstring once and went with the scratchpad.
  const src = fs.readFileSync(new URL('../tools/make-handout.mjs', import.meta.url), 'utf8');
  assert.match(src, /A REPLACEMENT STRING IS NOT A STRING/);
  assert.match(src, /re\.sub/, 'the Python original is where the bug was found');
  assert.match(src, /\$&/, 'nothing names the JavaScript form of the same trap');
  // And it must not have been "tidied" back into a string replacement.
  assert.ok(!/\.replace\([^)]*\bcss\b[^)]*\)/.test(src)
    && !/\.replace\([^)]*\bjs\b[^)]*\)/.test(src),
    'a file’s contents are being passed as a replacement string again');
});

group('The card text and its digest');

test('the digest covers the question, the body, the optional line and both labels', () => {
  const lines = cardLines('general');
  assert.ok(lines.includes(CARD.question));
  assert.ok(lines.includes(CARD.options.yes), 'an option label is part of what was answered');
  assert.ok(lines.includes(CARD.options.no));
  assert.ok(lines.includes(CARD.optionality));
});

test('the coordinator variant is a different sentence and so a different digest', () => {
  assert.notEqual(digestOf(cardLines('general')), digestOf(cardLines('coordinator')));
  assert.ok(cardLines('coordinator').includes(CARD.coordinatorNote));
  assert.ok(!cardLines('general').includes(CARD.coordinatorNote));
});

test('the digest is a full 64-character lowercase hex sha256', () => {
  assert.match(digestOf(cardLines('general')), /^[a-f0-9]{64}$/);
});

test('changing any visible word changes the digest', () => {
  const base = digestOf(cardLines('general'));
  assert.notEqual(base, digestOf([...cardLines('general').slice(0, -1), 'No thanks']));
});

test('the card describes TWO permissions, because there are two', () => {
  // It used to say "your report and anything you attached to it", which was
  // true when publishing was one decision. It is two: the words and the
  // files are answered separately, and only the second can be taken back.
  // One sentence covering both described a model that no longer exists, so
  // it was split.
  const body = CARD.body.join(' ');
  assert.ok(!/your report and anything you attached to it/.test(body),
    'the sentence that assumed one permission is back');

  // The report's own words, named as such.
  assert.match(body, /the report itself/);
  // And the files, said separately AND said to be revocable — which is a
  // promise the code keeps: src/renditions.js reads that permission at the
  // moment of publishing and taking it back takes published files down.
  assert.match(body, /asked about separately/);
  assert.match(body, /takes any published\s+file back down|back down/);
  // While this answer is not revocable, and the card has to say so or it is
  // offering a choice it will not honour.
  assert.match(body, /sealed into\s+the record|cannot be changed afterwards/);
  // The address still has to be excluded explicitly.
  assert.match(body, /email address is not part of what would be published/);
});

test('a changed card is a new row, never an edit, so old reports still read', () => {
  // The whole reason the split above is safe to make at all. A report seals
  // the digest of the text IT was shown; the text itself lives in an
  // insert-only table, so yesterday's wording is still readable and
  // yesterday's report still verifies.
  const src = fs.readFileSync(new URL('../src/consentText.js', import.meta.url), 'utf8');
  assert.match(src, /ON CONFLICT \(digest\) DO NOTHING/);
  assert.match(src, /INSERT INTO consent_texts/);
  assert.ok(!/UPDATE consent_texts|DELETE FROM consent_texts/.test(src),
    'the card text table is meant to be insert-only');

  // And nothing on the read side may recompute it, or changing a word would
  // retroactively break every report ever filed.
  for (const f of ['verify.js', 'chainFile.js', 'snapshot.js']) {
    const read = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.ok(!/digestOf|cardLines|cardFor/.test(read),
      `${f} recomputes the card digest instead of carrying the sealed one`);
  }
});

test('the card never calls itself consent', () => {
  // The lawful basis is deliberately not Article 6(1)(a) consent. Soliciting
  // "consent" and then not honouring withdrawal is the pattern regulators
  // treat as deceptive, and this is the text a reporter actually reads.
  for (const line of cardLines('coordinator')) {
    assert.ok(!/consent/i.test(line), `card text must not say consent: ${line}`);
  }
});

test('the card says what publication means, and that it is optional', () => {
  const all = cardLines('general').join(' ').toLowerCase();
  assert.ok(all.includes('permanent'), 'permanence must be stated');
  assert.ok(all.includes('search'), 'searchability must be stated');
  assert.ok(all.includes('download'), 'the CSV export must be stated');
  assert.ok(all.includes('either way'), 'filing must visibly work either way');
});

test('the card promises nothing about timing', () => {
  const all = cardLines('coordinator').join(' ').toLowerCase();
  for (const word of ['soon', 'later this', 'when we', 'once we', 'in future']) {
    assert.ok(!all.includes(word), `timing must not be mentioned: ${word}`);
  }
});

/* ------------------------------------------------------------------ */
group('A report verifies against what the database gives back');

// The bug this group exists for: <input type="time"> sends "09:30", that
// string was hashed, the database rendered it "09:30:00", and the verifier
// recomputed over the rendered form — every report filed through the web
// form failed its own verification. Answers now live in a jsonb column,
// which hands back exactly the JSON it was given, and a time answer is
// normalized to one written form before it is sealed.

test('a time answer is sealed in one written form, however the form sent it', () => {
  const f = [{ key: 'at', kind: 'time', label: 'At', settings: {} }];
  assert.equal(buildAnswers(f, { at: '09:30' }).answers.at, '09:30:00');
  assert.equal(buildAnswers(f, { at: '09:30:00' }).answers.at, '09:30:00');
  assert.equal(buildAnswers(f, { at: '' }).answers, undefined);
});

test('answers written and answers read back from jsonb hash the same', () => {
  const answers = buildAnswers([
    { key: 'at', kind: 'time', label: 'At', settings: {} },
    { key: 'on', kind: 'date', label: 'On', settings: {} },
    { key: 'what', kind: 'choice_many', label: 'What', settings: { options: ['b', 'a'] } },
  ], { at: '09:30', on: '2026-11-03', what: ['a', 'b'] }).answers;
  const meta = {
    publicRef: 'RL-000010', receivedAt: '2026-11-03T10:00:00.000Z',
    threadId: '44444444-4444-4444-4444-444444444444', correctsId: null,
  };
  const written = buildImmutableFields({
    ...meta,
    fields: normalizeReportFields({ logbook: 'lb', answers, may_publish: true, may_publish_digest: DIGEST }),
  });
  const rebuilt = immutableFieldsFor({
    public_ref: meta.publicRef, received_at: new Date(meta.receivedAt), thread_id: meta.threadId,
    corrects_id: null, recipe: 1, logbook_slug: 'lb',
    // What pg hands back for a jsonb column: the same JSON, parsed.
    answers: JSON.parse(JSON.stringify(answers)),
    may_publish: true, may_publish_digest: DIGEST,
  }, null);
  assert.equal(contentHash(rebuilt), contentHash(written));
});

/* ------------------------------------------------------------------ */
group('logbook fields — questions that are made, not built in');

const FIELDS = [
  { key: 'happened_on', kind: 'date', label: 'When', required: true, settings: {} },
  { key: 'started_at', kind: 'place', label: 'Where it started', settings: { options: [], allowOther: true } },
  { key: 'ended_at', kind: 'place', label: 'Where it ended', settings: { options: [], allowOther: true } },
  { key: 'tags', kind: 'choice_many', label: 'Tags', settings: { options: ['alpha', 'beta', 'gamma'] } },
];

test('a logbook can ask the same kind of question twice', () => {
  // THE WHOLE POINT. Place is a TYPE, so two place fields are ordinary —
  // impossible while location was a column.
  const { answers } = buildAnswers(FIELDS, {
    happened_on: '2026-11-03', started_at: 'Precinct 12', ended_at: 'The car park',
  });
  assert.equal(answers.started_at, 'Precinct 12');
  assert.equal(answers.ended_at, 'The car park');
});

test('an unanswered field has NO KEY, rather than a null one', () => {
  // The absent-key rule, one level down. Absent and null serialize
  // differently under RFC 8785, and "not answered" is a different claim
  // from "answered with nothing".
  const { answers } = buildAnswers(FIELDS, { happened_on: '2026-11-03' });
  assert.ok(!('started_at' in answers), 'an unanswered field must be absent');
  assert.deepEqual(Object.keys(answers), ['happened_on']);
});

test('a logbook that asked nothing seals no answers key at all', () => {
  const { answers } = buildAnswers([], {});
  assert.equal(answers, undefined, 'not {} — an empty object is still a key');
});

test('whatever else a body carries, only the logbook and its answers are sealed', () => {
  // A stale tab or a scripted client sending the old built-in questions
  // gets none of them into the seal: there is no built-in questionnaire.
  const sealed = normalizeReportFields({
    logbook: 'an-intake',
    answers: { what_happened: 'The door was locked' },
    may_publish: true,
    may_publish_digest: 'a'.repeat(64),
    narrative: 'An old-style account.',
    incident_date: '2026-09-10', states: ['Ohio'], categories: ['Something'],
    observer_status: 'public_onsite', severity: 'serious',
  });
  assert.deepEqual(Object.keys(sealed).sort(),
    ['answers', 'logbook', 'may_publish', 'may_publish_digest']);
  assert.equal(sealed.logbook, 'an-intake', 'the slug is sealed, never the id');
});

test('a required field that is missing is refused, not quietly dropped', () => {
  const { errors } = buildAnswers(FIELDS, { started_at: 'Precinct 12' });
  assert.deepEqual(errors, ['When is needed']);
});

test('the order of a multiple choice is the operator\'s, not the reporter\'s', () => {
  // Two people ticking the same boxes in a different order MUST produce the
  // same seal, or the same answer has two fingerprints.
  const a = buildAnswers(FIELDS, { happened_on: '2026-11-03', tags: ['gamma', 'alpha'] });
  const b = buildAnswers(FIELDS, { happened_on: '2026-11-03', tags: ['alpha', 'gamma'] });
  assert.deepEqual(a.answers.tags, ['alpha', 'gamma']);
  assert.equal(canonicalize(a.answers), canonicalize(b.answers));
});

test('a date is sealed in one form, and an impossible one is not sealed at all', () => {
  assert.equal(normalizeAnswer('date', '2026-11-03'), '2026-11-03');
  assert.equal(normalizeAnswer('date', '2026-02-31'), null, 'the 31st of February is not a day');
  assert.equal(normalizeAnswer('date', '3 Nov 2026'), null);
  assert.equal(normalizeAnswer('date', ''), null);
});

test('an answer outside the offered list is not an answer', () => {
  const settings = { options: ['alpha', 'beta'] };
  assert.equal(normalizeAnswer('choice_one', 'alpha', settings), 'alpha');
  assert.equal(normalizeAnswer('choice_one', 'delta', settings), null);
  assert.deepEqual(normalizeAnswer('choice_many', ['beta', 'delta'], settings), ['beta']);
});

test('a link that cannot be shown to somebody is refused', () => {
  assert.equal(normalizeAnswer('url', 'https://example.org/a'), 'https://example.org/a');
  assert.equal(normalizeAnswer('url', 'javascript:alert(1)'), null);
  assert.equal(normalizeAnswer('url', 'data:text/html,x'), null);
  assert.equal(normalizeAnswer('url', 'not a url'), null);
});

test('a field the logbook does not have is dropped, not rejected', () => {
  // A form open in a tab across a relaunch would otherwise fail on a key
  // nobody can see. Same trade the retired `layout` key took.
  const { answers, errors } = buildAnswers(FIELDS, {
    happened_on: '2026-11-03', a_field_that_went_away: 'x',
  });
  assert.deepEqual(errors, []);
  assert.ok(!('a_field_that_went_away' in answers));
});

test('every field type is one the builder can describe', () => {
  for (const id of FIELD_TYPE_IDS) {
    const t = fieldType(id);
    assert.ok(t && t.label && t.description, `${id} needs a label and a description`);
  }
  // Free prose is what the search box is for; offering a filter as well
  // invites somebody to expect the two to behave the same way.
  assert.ok(!canFilter('long_text'));
  assert.ok(canFilter('date') && canFilter('place') && canFilter('choice_many'));
});

test('the schema agrees with the type catalogue about field keys', () => {
  // The key is sealed into every report that answers the field, so the
  // database constrains its shape rather than trusting the builder.
  const m = fs.readFileSync(
    new URL('../migrations/027_logbooks.sql', import.meta.url), 'utf8');
  assert.match(m, /logbook_fields_key_check/);
  assert.match(m, /\^\[a-z0-9\]\[a-z0-9_\]/);
  assert.match(m, /UNIQUE \(logbook_id, key\)/);
});

/* ------------------------------------------------------------------ */
group('verify.js reads the row, not a list');

test('verify.js keeps no second copy of the column list', () => {
  // It had one, and it had drifted three times: a column added to the
  // hashed object and forgotten in the list comes back undefined, so the
  // report rebuilds as a different object and fails to verify.
  const v = fs.readFileSync(new URL('../src/verify.js', import.meta.url), 'utf8');
  assert.ok(!/ROW_COLUMNS/.test(v), 'the hand-maintained column list is gone');
  assert.match(v, /SELECT r\.\*/);
});

test('one written form of a time, whatever it arrives as', () => {
  assert.equal(toTimeString('09:30'), '09:30:00');
  assert.equal(toTimeString('09:30:00'), '09:30:00');
  assert.equal(toTimeString('09:30:45'), '09:30:45');
  assert.equal(toTimeString('9:05'), '09:05:00', 'a single-digit hour is padded');
  assert.equal(toTimeString('00:00'), '00:00:00');
});

test('an absent time stays absent rather than becoming midnight', () => {
  assert.equal(toTimeString(''), null);
  assert.equal(toTimeString(null), null);
  assert.equal(toTimeString(undefined), null);
});

/* ------------------------------------------------------------------ */
group('Append-only means append-only');

// PostgreSQL does not fire row-level triggers for TRUNCATE, so a table with a
// BEFORE DELETE OR UPDATE guard could still be emptied by one statement with
// the guard sitting there saying nothing. Eight tables were in that state
// until migration 007.
//
// The failure this catches is the next one: somebody adds an append-only
// table, copies the DELETE OR UPDATE trigger that every other one has, and
// does not know there is a second one to copy. Nothing else would notice.

const migrationsDir = new URL('../migrations/', import.meta.url);
const migrationSql = fs.readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(new URL(f, migrationsDir), 'utf8'))
  .join('\n');

const appendOnlyTables = [...migrationSql.matchAll(
  /CREATE TRIGGER \w+ BEFORE DELETE OR UPDATE ON (\w+)/g,
)].map((m) => m[1]);

const truncateGuarded = [...migrationSql.matchAll(
  /CREATE TRIGGER \w+ BEFORE TRUNCATE ON (\w+)/g,
)].map((m) => m[1]);

test('the migrations declare some append-only tables', () => {
  // A regex that silently matches nothing would leave the check below passing
  // over an empty list, which is the shape of a green suite that tests air.
  assert.ok(appendOnlyTables.length >= 8,
    `expected the known append-only tables, found ${appendOnlyTables.length}`);
});

test('every append-only table also refuses TRUNCATE', () => {
  const unguarded = appendOnlyTables.filter((t) => !truncateGuarded.includes(t));
  assert.deepEqual(unguarded, [],
    `these refuse DELETE and UPDATE but can still be emptied by one TRUNCATE: ${unguarded.join(', ')}`);
});

test('and the truncate guards are statement-level, which is the only form TRUNCATE has', () => {
  for (const m of migrationSql.matchAll(/CREATE TRIGGER (\w+) BEFORE TRUNCATE ON \w+\s*\n?\s*FOR EACH (\w+)/g)) {
    assert.equal(m[2], 'STATEMENT', `${m[1]} is FOR EACH ${m[2]}; a TRUNCATE trigger has no rows to run per`);
  }
});

/* ------------------------------------------------------------------ */
group('The curtain password');

// The floor, not a policy. The curtain is not what protects the archive —
// it keeps a half-finished deployment off the open internet and is shared
// casually between testers. What it refuses is the shapes that mean nobody
// chose one.

test('an empty password is refused', () => {
  assert.equal(validateCurtainPassword('').ok, false);
});

test('and so is one that is only whitespace', () => {
  assert.equal(validateCurtainPassword('        ').ok, false);
});

test('and so is one nobody would have typed on purpose', () => {
  assert.equal(validateCurtainPassword('abc').ok, false);
});

test('a password nobody set at all is refused rather than accepted as empty', () => {
  // The route passes through whatever arrived in the body. An absent key
  // must not become the empty string and then a password.
  assert.equal(validateCurtainPassword(undefined).ok, false);
  assert.equal(validateCurtainPassword(null).ok, false);
});

test('a real one is accepted, unchanged', () => {
  const r = validateCurtainPassword('correct horse battery');
  assert.equal(r.ok, true);
  // Not trimmed, not normalized, not case-folded. Whatever the operator
  // typed is what lifts the curtain, or the password they wrote down is not
  // the password.
  assert.equal(r.password, 'correct horse battery');
});

test('the floor is long enough to have been deliberate', () => {
  assert.ok(MIN_CURTAIN_PASSWORD >= 8);
});

/* ------------------------------------------------------------------ */
group('The operator\u2019s legal text');

// Free text and nothing else. A structured version — a mode flag, a field
// list, include checkboxes — was designed and reversed: what a legal notice
// must contain is decided by the jurisdiction the deployment runs from, and
// a field list here is this software asserting it knows which fields those
// are. So there is nothing to validate, and these check the one distinction
// that does carry meaning.

test('nothing written reads as nothing published', () => {
  assert.equal(resolveLegalText(null, 'impressum'), null);
  assert.equal(resolveLegalText({ impressum_text: null }, 'impressum'), null);
});

test('and an empty string is the same answer, not a blank page', () => {
  assert.equal(resolveLegalText({ impressum_text: '' }, 'impressum'), null);
  assert.equal(resolveLegalText({ privacy_text: '   \n\t ' }, 'privacy'), null);
});

test('what an operator wrote comes back exactly as typed', () => {
  const text = 'Munich Incident Archive e.V.\nBeispielstraße 1';
  assert.equal(resolveLegalText({ impressum_text: text }, 'impressum'), text);
});

test('nothing about the content is checked, because there is nothing to check it against', () => {
  // A notice nobody would call complete is still the operator's to publish.
  const r = validateLegalText('we do not have one, ask me');
  assert.equal(r.ok, true);
  assert.equal(r.value, 'we do not have one, ask me');
});

test('clearing the box stores nothing published rather than a blank page', () => {
  assert.equal(validateLegalText('').value, null);
  assert.equal(validateLegalText('   ').value, null);
});

test('the editor opens on the outline only while nothing is published', () => {
  const empty = editorStartingText(null, 'impressum');
  assert.equal(empty.published, false);
  assert.equal(empty.text, SKELETONS.impressum);

  const written = editorStartingText({ impressum_text: 'ours' }, 'impressum');
  assert.equal(written.published, true);
  assert.equal(written.text, 'ours');
});

test('the outline is an outline, and never reads as a finished notice', () => {
  for (const kind of LEGAL_KINDS) {
    const skeleton = SKELETONS[kind];
    // Bracketed blanks, so every unfilled line is visibly unfilled.
    assert.ok(/\[[^\]]+\]/.test(skeleton), kind);
    // And it says so at the top rather than leaving it to be inferred.
    // Tolerant of the line wrap: the outline is hard-wrapped prose.
    assert.ok(/not legal\s+advice/i.test(skeleton), kind);
    assert.ok(/outline/i.test(skeleton), kind);
  }
});

test('the imprint outline names what a jurisdiction is likely to ask for', () => {
  // Prompts, not answers. If these disappear the outline stops being worth
  // opening the editor for.
  for (const heading of ['RESPONSIBLE ENTITY', 'POSTAL ADDRESS', 'CONTACT']) {
    assert.ok(SKELETONS.impressum.includes(heading), heading);
  }
});

test('the privacy outline prompts for what this software actually does', () => {
  // The facts an operator cannot be expected to know unprompted: the
  // encrypted contact details, and that the archive cannot be erased.
  assert.ok(/encrypted/i.test(SKELETONS.privacy));
  assert.ok(/append-only/i.test(SKELETONS.privacy));
  assert.ok(/erasure/i.test(SKELETONS.privacy));
});

/* ------------------------------------------------------------------ */
group('Deployment templates');

// A template is a bundle of settings APPLIED ONCE, not a mode. These are
// the checks that keep it that way, and the first two are the ones that
// matter — they are the anti-pigeonhole argument made checkable.

const applySrc = fs.readFileSync(new URL('../src/applyTemplate.js', import.meta.url), 'utf8');
const templatesSrc = fs.readFileSync(new URL('../src/templates.js', import.meta.url), 'utf8');

test('nothing reads which template was applied in order to decide anything', () => {
  // THE ONE THAT MATTERS. The moment any code branches on this, templates
  // stop being a starting point and become a permanent fork.
  const tree = ['../src/reportCore.js', '../src/verify.js', '../src/publication.js',
    '../src/attachments.js', '../src/intakeGate.js', '../src/siteCopy.js',
    '../src/logbooks.js', '../src/look.js', '../src/siteIdentity.js',
    '../src/routes/reports.js', '../src/routes/intake.js', '../src/routes/publicApi.js'];
  for (const file of tree) {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/template_applied|templateById|applyTemplate/.test(src),
      `${file} reads the applied template`);
  }
});

test('a template may only set things that are already settings', () => {
  for (const t of TEMPLATES) {
    for (const key of Object.keys(t.settings || {})) {
      assert.ok(TEMPLATE_KEYS.includes(key), `${t.id} sets ${key}`);
    }
  }
  assert.equal(validateTemplate({ settings: { somethingNew: 1 } }).ok, false);
});

test('and may NEVER write legal text', () => {
  // A template that pre-filled these would publish a placeholder as
  // somebody's legal notice, which is the exact failure migration 013
  // exists to prevent.
  for (const key of ['impressum', 'privacy', 'impressum_text', 'privacy_text']) {
    assert.equal(validateTemplate({ settings: { [key]: 'x' } }).ok, false, key);
    assert.ok(!TEMPLATE_KEYS.includes(key));
  }
  for (const t of TEMPLATES) {
    assert.ok(!/impressum|privacy/i.test(JSON.stringify(t.settings || {})), t.id);
  }
  assert.ok(!/impressum_text|privacy_text/.test(applySrc), 'the applier touches legal text');
});

test('every shipped template passes the same validation an admin would', () => {
  // A template must not be able to write a value an administrator could
  // not. Shipped data today, operator data tomorrow.
  for (const t of TEMPLATES) {
    const plan = planTemplate(t);
    assert.ok(plan.ok, `${t.id}: ${plan.error}`);
  }
});

test('a template carrying a bad value is refused whole, before anything is written', () => {
  const bad = { settings: { theme: 'no_such_theme', intake: true } };
  assert.equal(planTemplate(bad).ok, false);
  const alsoBad = { settings: { copy: { home_headline: 'has\na newline' } } };
  assert.equal(planTemplate(alsoBad).ok, false);
  const notBoolean = { settings: { intake: 'yes' } };
  assert.equal(planTemplate(notBoolean).ok, false);
});

test('a template brings a DRAFT logbook, and never touches one that exists', () => {
  // Launching is the one step that cannot be undone, so it is never done on
  // an operator's behalf; and a logbook already there may already hold
  // reports, so a template only ever adds.
  assert.ok(/createFromFile/.test(applySrc));
  assert.ok(!/\blaunch\(/.test(stripComments(applySrc)), 'the applier launches nothing');
  assert.ok(!/UPDATE logbooks|DELETE FROM logbook/.test(applySrc));
});

test('every shipped template logbook is a valid logbook file', () => {
  for (const t of TEMPLATES) {
    if (t.settings.logbook === undefined) continue;
    const f = templateLogbook(t.settings.logbook);
    assert.ok(f, `${t.id} names a logbook file that does not exist`);
    assert.deepEqual(validateLogbookFile(f), [], t.id);
  }
});

test('the no-files-no-free-text template is exactly that, and only that', () => {
  // Not a mode: a logbook file whose questions are all choices and which
  // takes no files, on a site whose file storage is off. Every one of those
  // is changeable afterwards like on any other logbook.
  const t = TEMPLATES.find((x) => x.id === 'elections-choices');
  assert.equal(t.settings.attachments, false);
  const f = templateLogbook(t.settings.logbook);
  assert.equal(f.accepts_files, false);
  for (const q of f.questions) {
    assert.ok(!['short_text', 'long_text', 'email', 'url'].includes(q.kind), `${q.key} is free text`);
    if (q.kind === 'place') assert.equal(q.allow_other, false, `${q.key} lets somebody type`);
  }
});

test('and applies everything in one transaction', () => {
  // A template half applied is worse than none: a deployment partly one
  // thing and partly another, with nothing on screen saying which parts took.
  assert.ok(/BEGIN/.test(applySrc) && /COMMIT/.test(applySrc) && /ROLLBACK/.test(applySrc));
});

test('every template says what it will change before it is applied', () => {
  for (const t of templateSummaries()) {
    assert.ok(t.label && t.description, t.id);
    assert.ok(Array.isArray(t.sets) && t.sets.length > 0, `${t.id} describes nothing`);
  }
});

test('a key a template omits is left alone, not reset', () => {
  // So a narrow template can stay narrow. Checked on the shape rather than
  // the prose: the applier guards every write on `!== undefined`.
  const guards = applySrc.match(/if \(s\.\w+ !== undefined\)/g) || [];
  assert.ok(guards.length >= 6, JSON.stringify(guards));
  assert.deepEqual(describeSettings({}), []);
});

/* ---- starting a LOGBOOK, which is not starting a deployment ----------- */

test('a logbook starting point carries questions and nothing about the site', () => {
  const points = logbookStartingPoints();
  assert.ok(points.length > 0, 'no starting points are offered at all');
  for (const p of points) {
    assert.ok(p.id && p.title, JSON.stringify(p));
    assert.ok(p.questions > 0, `${p.id} offers no questions`);
    // THE WHOLE DISTINCTION. A template writes site settings wholesale and is
    // offered once, by the first-run wizard. A starting point is how a LOGBOOK
    // begins, and a deployment makes logbooks for years — so one carrying a
    // palette, a name or a publication switch would mean adding a second
    // logbook could rewrite the settings of a site running for months.
    for (const forbidden of ['siteName', 'palette', 'theme', 'publicArchive',
      'distribution', 'attachments', 'intake', 'copy', 'clearCopy']) {
      assert.ok(!(forbidden in p), `${p.id} carries ${forbidden}, which is a site setting`);
    }
  }
});

test('and is described from the file, so a count cannot go stale', () => {
  // Read out of templates/*.json rather than restated beside it: a question
  // added to a shipped logbook would otherwise leave this page claiming the
  // old number, which is the same fault the palette parsing exists to avoid.
  for (const p of logbookStartingPoints()) {
    const file = templateLogbook(p.id);
    assert.ok(file, `${p.id} names no file`);
    assert.equal(p.questions, file.questions.length, p.id);
    assert.equal(p.title, file.title, p.id);
    const asksFiles = Boolean(file.accepts_files)
      || file.questions.some((q) => q.kind === 'file');
    assert.equal(p.takesFiles, asksFiles, p.id);
  }
});

test('every starting point is a logbook file the importer would accept', () => {
  // Offered in the wizard means created through createFromFile, so a shipped
  // file that does not validate is a button that always errors.
  for (const p of logbookStartingPoints()) {
    assert.deepEqual(validateLogbookFile(templateLogbook(p.id)), [], p.id);
  }
});

test('the stubs stress different parts of the design, not different subjects', () => {
  // Chosen to exercise the design rather than to look like elections.
  // src/templates.js says which part each one is for; this holds them to it.
  const byId = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

  // THE EDITORIAL LAYER WITH NOTHING PUBLISHING, which nothing else
  // exercises: an internal log still has readers — the people who have to
  // act on it — and "what we established about this" is worth as much
  // internally as in public.
  const safety = byId['safety-log'];
  assert.ok(safety, 'the internal safety log stub is gone');
  assert.equal(safety.settings.publicArchive, false);
  assert.equal(templateLogbook('safety-log').editorial_notes, true,
    'archive off with notes on is the whole point of this stub');

  // THE SPINE WHERE ANONYMITY IS NOT ON OFFER.
  const complaint = byId['professional-complaint'];
  assert.ok(complaint, 'the practitioner complaint stub is gone');
  assert.equal(complaint.settings.publicArchive, false);
  const qs = templateLogbook('professional-complaint').questions;
  const name = qs.find((q) => q.key === 'your_name');
  assert.ok(name && name.required, 'the complaint does not actually require a name');

  // IDENTITY REQUIRED IS NOT A SETTING, and must not become one. A
  // `deployment_type` the code consults is refused outright
  // (docs/reference.md §21.5), and "anonymous filing off" as a site switch
  // would be that by another name — it would have to mean something
  // different on every logbook of a deployment running several.
  const src = fs.readFileSync(new URL('../src/templates.js', import.meta.url), 'utf8');
  assert.ok(!/anonymous\s*:/.test(src), 'anonymity became a template setting');
  assert.ok(!/requireIdentity|identityRequired/.test(src));
  for (const t of TEMPLATES) {
    for (const k of Object.keys(t.settings)) {
      assert.ok(TEMPLATE_KEYS.includes(k), `${t.id} sets ${k}, which is not a setting`);
    }
  }
});

test('the complaint warns before it asks for a name, and asks nothing before that', () => {
  // A required name question that arrives unannounced is a form somebody
  // abandons on the card that asks it — and abandoning it after typing an
  // account of something that happened to them is worse than not starting.
  const qs = templateLogbook('professional-complaint').questions;
  const first = qs[0];
  assert.equal(first.key, 'understood', 'something is asked before the warning');
  assert.equal(first.kind, 'yes_no');
  assert.match(first.label, /cannot be anonymous/i);
  // It says what it costs: sealed, and not retractable.
  assert.match(first.help, /seals it/);
  assert.match(first.help, /cannot be taken back/);

  // AND EVERY LATER QUESTION WAITS ON IT, so somebody who says no is asked
  // nothing else. One that did not would be a question put to a person who
  // had just declined the terms of the whole logbook.
  const after = qs.slice(1).filter((q) => q.key !== 'evidence_of');
  for (const q of after) {
    assert.ok(q.shown_when, `${q.key} is asked before the warning is answered`);
    assert.equal(q.shown_when.field, 'understood', q.key);
    assert.deepEqual(q.shown_when.in, ['yes'], q.key);
  }
  // The evidence follow-up hangs off the declaration instead, which hangs
  // off the warning — so it is still gated, one step further along.
  const follow = qs.find((q) => q.key === 'evidence_of');
  assert.equal(follow.shown_when.field, 'has_evidence');
});

test('every shipped logbook offers the evidence pair as two cards', () => {
  // So an operator meets a worked example in whichever starting point they
  // pick, rather than having to invent the pairing from the field list.
  // elections-choices is the exception by design: it asks for nothing typed
  // and nothing uploaded.
  for (const id of LOGBOOK_STARTING_POINTS) {
    if (id === 'elections-choices') continue;
    const qs = templateLogbook(id).questions;
    const d = qs.find((q) => q.kind === 'evidence_declaration');
    assert.ok(d, `${id} asks no evidence declaration`);
    assert.ok(!d.required, `${id}'s declaration is compulsory`);
    assert.match(d.help, /Nothing is uploaded/,
      `${id} does not say that answering uploads nothing`);
    const follow = qs.find((q) => q.shown_when && q.shown_when.field === d.key);
    assert.ok(follow, `${id} never asks what the evidence is of`);
    assert.equal(follow.kind, 'short_text', id);
    // And it comes after the question it depends on, or the server refuses
    // it as a forward reference.
    const keys = qs.map((q) => q.key);
    assert.ok(keys.indexOf(d.key) < keys.indexOf(follow.key), id);
  }
});

test('a shipped logbook asks nothing it has not thought about twice', () => {
  // Cheap checks that catch a copy-paste: a duplicate key silently loses an
  // answer, and a condition naming a question that is not there is a
  // question nobody is ever asked.
  for (const id of LOGBOOK_STARTING_POINTS) {
    const qs = templateLogbook(id).questions;
    const keys = qs.map((q) => q.key);
    assert.equal(new Set(keys).size, keys.length, `${id} has a duplicate key`);
    for (const q of qs) {
      assert.match(q.key, /^[a-z][a-z0-9_]*$/, `${id}: ${q.key}`);
      assert.ok(q.label && q.label.length < 160, `${id}: ${q.key} has no usable label`);
      if (!q.shown_when) continue;
      assert.ok(keys.includes(q.shown_when.field),
        `${id}: ${q.key} waits on ${q.shown_when.field}, which it does not ask`);
      // A question asked only sometimes cannot be required OF EVERYBODY —
      // and a required conditional one is a form that cannot be completed
      // by whoever it is hidden from.
      const target = qs.find((x) => x.key === q.shown_when.field);
      assert.ok(['yes_no', 'choice_one', 'choice_many', 'evidence_declaration']
        .includes(target.kind),
      `${id}: ${q.key} is conditional on a ${target.kind}, which the server refuses`);
    }
  }
});

test('migration 019 records the choice and constrains nothing', () => {
  const m = fs.readFileSync(new URL('../migrations/019_templates.sql', import.meta.url), 'utf8');
  const statements = m.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.ok(/ADD COLUMN IF NOT EXISTS template_applied\b/.test(statements));
  // No CHECK listing the template ids: they live in the code, and a
  // deployment that dropped one must not become unwritable.
  assert.ok(!/CHECK/i.test(statements));
  assert.ok(!/ALTER TABLE\s+reports\b/i.test(statements));
});

test('\u201cstart from nothing\u201d actually clears what it names', () => {
  // The complaint that produced this: pressing it changed nothing visible,
  // because the rule everywhere else here is that an omitted key is left
  // alone, and the template omitted the name and the page text. Clearing
  // had to become something a template SAYS.
  const blank = TEMPLATES.find((t) => t.id === 'blank').settings;
  assert.equal(blank.clearCopy, true, 'the page text is cleared, not omitted');
  assert.equal(blank.logbook, undefined, 'and it makes no logbook');

  // THE NAME IS THE ONE THING IT NO LONGER CLEARS, and that is not a
  // regression of the complaint above. The setup wizard asks for the name
  // BEFORE the starting point now, and asks for it as a required answer — so
  // a template clearing it would wipe what somebody typed on the screen
  // before and hand them a deployment called ReportLog. Everything else it
  // names, it still clears.
  assert.equal(blank.siteName, undefined, 'the name is not a starting point\u2019s business');

  // And says so before it is pressed, in the list the panel prints.
  const sets = describeSettings(blank).join(' | ');
  assert.ok(!/Clears the name/.test(sets), sets);
  assert.match(sets, /Clears every piece of page text/);
});

test('clearing is explicit, and still cannot reach the legal text', () => {
  const blank = TEMPLATES.find((t) => t.id === 'blank');
  assert.deepEqual(validateTemplate(blank), { ok: true });

  // Page text goes back to no row at all, which is what "use what ships"
  // is stored as. The imprint and the privacy policy are not in this table
  // and there is no statement here that could reach them.
  assert.match(applySrc, /if \(s\.clearCopy\)/);
  assert.match(applySrc, /DELETE FROM site_copy/);
  const deletes = applySrc.match(/DELETE FROM (\w+)/g) || [];
  assert.deepEqual([...new Set(deletes)], ['DELETE FROM site_copy'],
    'the applier deletes from nothing else');

  // An omitted clearCopy leaves the text alone, like every other key.
  assert.deepEqual(describeSettings({}), []);
});

test('the ids are distinct and the catalogue is not empty', () => {
  assert.equal(new Set(TEMPLATE_IDS).size, TEMPLATE_IDS.length);
  assert.ok(TEMPLATE_IDS.length >= 2);
  assert.ok(!/\bTODO\b/.test(templatesSrc));
});

/* ------------------------------------------------------------------ */
/* The shipped frontend, in whatever files the page itself names.

   public/index.html carried the whole of it until the split: a 1,374-line
   <style> block and a 6,540-line <script>. The rules are six files in
   public/css/ now and the code is twenty-two modules in public/js/.

   EVERY CHECK BELOW THAT GREPS FOR A RULE OR A FUNCTION READS THIS, and the
   lists are discovered from the page rather than written out here. A grep
   that matches nothing looks exactly like a grep that passes, so a seventh
   stylesheet or a twenty-third module must not be able to slip past a check
   by being new \u2014 if the page links it, the checks see it. */
const indexHtml = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const readPublic = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const LINKED_CSS = [...indexHtml.matchAll(/<link rel="stylesheet" href="\/(css\/[a-z-]+\.css)">/g)]
  .map((m) => m[1]);
const LINKED_JS = [...indexHtml.matchAll(/<script type="module" src="\/(js\/[a-z-]+\.js)"><\/script>/g)]
  .map((m) => m[1]);
// Joined with a newline so a rule or a statement at the end of one file
// cannot run into the start of the next and match across the seam.
const pageCss = LINKED_CSS.map(readPublic).join('\n');
const pageJs = LINKED_JS.map(readPublic).join('\n');
// Every page this repository ships. A policy is only as good as the page that
// forces the weakest directive, so the inline-script check reads all of them.
const SHIPPED_PAGES_ALL = fs.readdirSync(new URL('../public', import.meta.url))
  .filter((f) => f.endsWith('.html')).sort();

/* ------------------------------------------------------------------ */
group('The words on an operator\u2019s own pages');

const copyHtml = indexHtml;

test('nothing written falls back to what ships, rather than to nothing', () => {
  // The deliberate difference from the legal text. A missing privacy policy
  // must SAY it is missing, because a placeholder that reads like a policy
  // is dangerous. A front page has a safe default that already ships.
  //
  // AN OPTIONAL SLOT IS THE EXCEPTION AND FALLS BACK TO NOTHING, on purpose: it
  // is an extra paragraph an operator may add, and the page hides it until they
  // do. A fallback there would put our note to the operator in front of somebody
  // filing an account of something that happened to them. Asserted both ways
  // round so neither kind can quietly become the other.
  for (const slot of COPY_SLOTS) {
    const out = resolveCopy([], slot.key);
    if (slot.optional) {
      assert.equal(out, '', `${slot.key} is optional and must fall back to nothing`);
    } else {
      assert.ok(out && out.length > 10, slot.key);
    }
  }
  assert.equal(resolveCopy([{ key: 'home_headline', body: '   ' }], 'home_headline'),
    COPY_SLOTS[0].fallback);
});

test('what an operator wrote comes back exactly as typed', () => {
  const text = 'Reports from the Ruhr district.\n\nAnyone may file.';
  assert.equal(resolveCopy([{ key: 'home_intro', body: text }], 'home_intro'), text);
});

test('an unknown slot is nothing, not an accident', () => {
  assert.equal(resolveCopy([], 'no_such_slot'), null);
  assert.equal(validateCopy('no_such_slot', 'hello').ok, false);
});

test('every slot the editor offers is read by the page', () => {
  // A text box that changes nothing is worse than no text box.
  for (const key of COPY_KEYS) {
    assert.ok(copyHtml.includes(`data-copy="${key}"`), `${key} has no element reading it`);
  }
});

test('and every element on the page names a slot that exists', () => {
  const inPage = [...copyHtml.matchAll(/data-copy="([a-z0-9_]+)"/g)].map((m) => m[1]);
  assert.ok(inPage.length >= COPY_KEYS.length);
  for (const key of new Set(inPage)) {
    assert.ok(COPY_KEYS.includes(key), `${key} is on the page but is not a slot`);
  }
});

test('the markup carries each slot\u2019s own fallback, so the page reads before any fetch', () => {
  // The page has to be correct with JavaScript still loading and correct if
  // the fetch never answers. Checked on the headline, which is the one a
  // visitor sees first.
  const headline = COPY_SLOTS.find((s) => s.key === 'home_headline');
  assert.ok(copyHtml.includes(`data-copy="home_headline">${headline.fallback}`));
});

test('a single-line slot refuses a line break', () => {
  // A headline with a newline in it is a headline that will not lay out.
  assert.equal(validateCopy('home_headline', 'One line\nTwo lines').ok, false);
  assert.equal(validateCopy('home_headline', 'One line').ok, true);
  assert.equal(validateCopy('home_lede', 'One line\nTwo lines').ok, true);
});

test('and a length it could not lay out either', () => {
  assert.equal(validateCopy('home_headline', 'x'.repeat(MAX_LINE_LEN + 1)).ok, false);
});

test('clearing a slot stores nothing, so a reset reads like never touched', () => {
  assert.equal(validateCopy('home_intro', '').value, null);
  assert.equal(validateCopy('home_intro', '   ').value, null);
});

test('the editor says which wording is the operator\u2019s and which is ours', () => {
  const fresh = editorCopy([]);
  assert.ok(fresh.every((s) => s.written === false));
  assert.equal(fresh[0].body, fresh[0].fallback);

  const written = editorCopy([{ key: 'home_headline', body: 'Ours' }]);
  const slot = written.find((s) => s.key === 'home_headline');
  assert.equal(slot.written, true);
  assert.equal(slot.body, 'Ours');
});

test('page copy is never hashed and the chain cannot see it', () => {
  for (const file of ['../src/reportCore.js', '../src/verify.js']) {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/siteCopy|site_copy|data-copy/.test(src), file);
  }
});

test('migration 017 keeps the valid keys in the code, not in a constraint', () => {
  const m = fs.readFileSync(new URL('../migrations/017_site_copy.sql', import.meta.url), 'utf8');
  const statements = m.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.ok(/CREATE TABLE IF NOT EXISTS site_copy/.test(statements));
  // A CHECK listing the slots would put the list in two places and make
  // adding a paragraph a migration again, which is the whole thing this
  // table exists to avoid.
  for (const key of COPY_KEYS) {
    assert.ok(!statements.includes(`'${key}'`), `${key} is welded into the migration`);
  }
});

/* ------------------------------------------------------------------ */
group('The look: three axes that do not overlap');

// The look moved out of the page into its own stylesheet when a second and
// third surface started needing it. These checks are about the look wherever
// it is written, so they read both and check the pair.
//
// The second half is the page's own rules, which are six files in
// public/css/ rather than a <style> block. If this went on reading
// index.html it would still pass and would be checking an empty string.
const tokensCss = fs.readFileSync(new URL('../public/tokens.css', import.meta.url), 'utf8');
const lookHtml = `${tokensCss}\n${pageCss}`;

test('nobody having chosen resolves to the shipped look', () => {
  assert.deepEqual(resolveLook(null), DEFAULT_LOOK);
  assert.deepEqual(resolveLook({ palette: null, theme: '', layout: undefined }), DEFAULT_LOOK);
});

test('a value that no longer exists resolves to the default, not to nothing', () => {
  // A palette dropped in a later version would otherwise leave data-palette
  // naming nothing — a page with no colours at all rather than the shipped
  // ones.
  const out = resolveLook({ palette: 'retired', theme: 'retired', layout: 'retired' });
  assert.deepEqual(out, DEFAULT_LOOK);
  assert.equal(validateLook({ palette: 'retired' }).ok, false);
});

test('every palette offered has CSS behind it, and every CSS block is offered', () => {
  for (const id of PALETTE_IDS) {
    if (id === DEFAULT_LOOK.palette) continue;
    assert.ok(lookHtml.includes(`[data-palette="${id}"]`), `${id} has no CSS`);
  }
  const inCss = [...lookHtml.matchAll(/\[data-palette="([a-z0-9_-]+)"\]/g)].map((m) => m[1]);
  for (const id of new Set(inCss)) {
    assert.ok(PALETTE_IDS.includes(id), `${id} is painted but not offered`);
  }
});

test('every theme offered has CSS behind it', () => {
  for (const id of THEME_IDS) {
    if (id === DEFAULT_LOOK.theme) continue;
    assert.ok(lookHtml.includes(`[data-theme="${id}"]`), `${id} has no CSS`);
  }
});

test('WIDTH BELONGS TO THE THEME — the third axis is gone', () => {
  // Three axes became two. Each theme is a finished opinion and its measure
  // is part of the opinion, so every one states its own --page-max rather
  // than inheriting a width somebody chose separately.
  for (const { id } of THEMES) {
    const sel = id === DEFAULT_LOOK.theme
      // The shipped theme shares its block with the attribute-less page.
      ? /:root,\s*\[data-theme="signal"\]\{([^}]*)\}/
      : new RegExp(`\\[data-theme="${id}"\\]\\{([^}]*)\\}`);
    const block = lookHtml.match(sel);
    assert.ok(block, `${id} has no theme block`);
    assert.match(block[1], /--page-max:\s*\d+px/, `${id} does not state its own width`);
  }
});

test('and nothing is left that reads the retired axis', () => {
  // A leftover data-layout rule would be CSS nothing can ever select, and
  // the next reader would reasonably assume the axis still worked.
  assert.doesNotMatch(lookHtml, /\[data-layout=/, 'the layout axis still has CSS');
  assert.deepEqual(LAYOUTS, [], 'the layout catalogue still offers choices');
  assert.deepEqual(Object.keys(resolveLook({ palette: 'bone', theme: 'docket', layout: 'wide' })).sort(),
    ['palette', 'theme'], 'resolveLook still returns a layout');
  // A body still carrying the dead key is ignored, not refused: an admin
  // page left open in a tab must not start erroring after a deploy.
  const v = validateLook({ theme: 'docket', layout: 'wide' });
  assert.equal(v.ok, true);
  assert.deepEqual(v.value, { theme: 'docket' });
});

test('migration 021 retires the column without dropping it', () => {
  const sql = fs.readFileSync(new URL('../migrations/021_layout_retired.sql', import.meta.url), 'utf8');
  assert.match(sql, /COMMENT ON COLUMN site_settings\.layout/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|ALTER TABLE/i,
    'migrations after 001_init.sql are additive; this one only comments');
});

test('A THEME SETS NO COLOUR — the rule the two axes rest on', () => {
  // THE ONE THAT MATTERS. Palette owns colour and theme owns shape. A theme
  // that reached for a colour would make the pair fight, and the
  // combination an operator picked would stop being predictable.
  const blocks = [...lookHtml.matchAll(/\[data-theme="[a-z0-9_-]+"\]\{([^}]*)\}/g)]
    .map((m) => m[1]);
  assert.ok(blocks.length >= 3, 'no theme blocks found to check');
  for (const body of blocks) {
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(body), `a theme names a hex colour: ${body.slice(0, 80)}`);
    assert.ok(!/\brgba?\(/i.test(body), 'a theme names an rgb colour');
    assert.ok(!/--color--/.test(body), 'a theme reaches into the palette');
  }
});

test('serious is a red and confirmed is a teal, in EVERY palette', () => {
  // Crimson is serious or an error; teal is a moderator confirmed this.
  // Checked by HUE rather than by exact value on purpose: tuning a red
  // lighter so it carries on a dark ground is correct, and changing it to a
  // blue is not. The ported palettes rendered confirmed as near-black text
  // — a confirmation the same colour as the paragraph beside it — which is
  // the regression this catches.
  const hueOf = (hex) => {
    const h = hex.trim().replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
    if (!d) return { h: 0, sat: 0 };
    let deg;
    if (max === r) deg = ((g - b) / d) % 6;
    else if (max === g) deg = (b - r) / d + 2;
    else deg = (r - g) / d + 4;
    return { h: (deg * 60 + 360) % 360, sat: d / (1 - Math.abs(max + min - 1) || 1) };
  };
  const blocks = [...lookHtml.matchAll(/\[data-palette="[a-z0-9_-]+"\]\{([^}]*)\}/g)]
    // On the DECLARATION, not the substring: the bridge block mentions both
    // tokens inside a color-mix() without declaring either.
    .map((m) => m[1]).filter((b) => /--color--status-serious:/.test(b)
      && /--color--status-confirmed:/.test(b));
  assert.ok(blocks.length >= 8, `only ${blocks.length} palettes carry status colours`);
  for (const body of blocks) {
    const s1 = hueOf(body.match(/--color--status-serious:\s*([^;]+)/)[1]);
    const c1 = hueOf(body.match(/--color--status-confirmed:\s*([^;]+)/)[1]);
    assert.ok(s1.h >= 340 || s1.h <= 20, `serious is not a red: hue ${Math.round(s1.h)}`);
    assert.ok(c1.h >= 140 && c1.h <= 200, `confirmed is not a teal: hue ${Math.round(c1.h)}`);
    assert.ok(c1.sat > 0.15, 'confirmed has no colour in it at all');
  }
});

test('no form control hardcodes a white ground while its text follows the palette', () => {
  // The first dark palette turned every input into white text on white
  // paper, because the colour moved and the background did not.
  const screen = lookHtml.split('@media print')[0];
  assert.ok(!/background:\s*#[fF]{3,6}\b/.test(screen),
    'something on screen still hardcodes white');
});

test('nine dark palettes are offered, and the light ones are still light', () => {
  // These were withheld for one release. --ink means the text colour, so a
  // dark palette makes it near-white, while twenty-five rules used
  // background:var(--ink) meaning "a dark block" — Harbour measured 1.41:1
  // against a required 4.5:1. The inverse-surface pass (--solid vs the deep
  // pair) is what made them shippable; this is what says they shipped.
  assert.equal(PALETTES.filter((p) => p.dark).length, 9);
  assert.equal(PALETTES.filter((p) => !p.dark).length, 9);
  assert.ok(isDarkPalette('midnight'));
  assert.ok(!isDarkPalette('electionlog'));
  assert.ok(!isDarkPalette('nonesuch'));
});

test('offered and painted agree in both directions', () => {
  // A palette in the catalogue with no CSS renders an unstyled page; CSS
  // with no catalogue entry means a link carrying ?palette= finds paint the
  // editor will never offer. Both are silent, so both are asserted.
  const painted = [...lookHtml.matchAll(/\[data-palette="([^"]+)"\]/g)].map((m) => m[1]);
  for (const id of PALETTE_IDS) {
    if (id === DEFAULT_LOOK.palette) continue; // the default is bare :root
    assert.ok(painted.includes(id), `${id} is offered but never painted`);
  }
  for (const id of painted) {
    assert.ok(PALETTE_IDS.includes(id), `${id} is painted but never offered`);
  }
});

test('every dark palette says what reads on a confirmed chip', () => {
  // Teal means A MODERATOR CONFIRMED THIS in all eighteen palettes, but a
  // dark ground needs a LIGHT teal to show at all — and white text on light
  // teal is unreadable, where white on the light palettes' dark teal is the
  // only thing that works. So the palette states it and the chip does not
  // assume. A dark palette that forgot would silently inherit white.
  for (const { id, dark } of PALETTES) {
    if (!dark) continue;
    const block = lookHtml.match(
      new RegExp(`\\[data-palette="${id}"\\]\\{([^}]*)\\}`),
    );
    assert.ok(block, `${id} has no palette block`);
    assert.ok(/--color--on-confirmed:/.test(block[1]), `${id} never sets --color--on-confirmed`);
    assert.ok(/--color--status-confirmed:/.test(block[1]), `${id} never sets --color--status-confirmed`);
  }
});

test('the inverse-surface tokens exist and the habit they replaced is gone', () => {
  // This is the whole of why the dark palettes work. A solid block flips
  // with the palette; a deep surface does not. Written as one thing, nine
  // correct palettes measured 1.41:1.
  for (const token of ['--solid:', '--on-solid:', '--on-verify:', '--on-seal:', '--rule-deep:']) {
    assert.ok(lookHtml.includes(token), `${token} is missing`);
  }
  // Every remaining color:#fff in the stylesheet must be inside a comment
  // or a print rule — on paper the ground really is white.
  const style = `${tokensCss}\n${pageCss}`;
  const printFree = style.replace(/@media print\{[\s\S]*?\n\}/g, '');
  for (const line of printFree.split('\n')) {
    if (/^\s*(\/\*|\*|[a-z-]+ )/i.test(line) && !line.includes('{')) continue;
    assert.ok(
      !/background:var\(--ink\);color:#fff/.test(line),
      `a solid block is still written as ink-and-white: ${line.trim()}`,
    );
  }
});

test('nothing in the chain can see any of it', () => {
  for (const file of ['../src/reportCore.js', '../src/verify.js']) {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/palette|look\.js|data-theme/i.test(src), file);
  }
});

test('every choice has a label and a description somebody can choose between', () => {
  for (const list of [PALETTES, THEMES, LAYOUTS]) {
    for (const item of list) {
      assert.ok(item.label && item.label.length > 1, item.id);
      assert.ok(item.description && item.description.length > 15, item.id);
    }
  }
});

test('one axis may be set without disturbing the others', () => {
  // The editor sends one key as each dial turns, so a palette change must
  // not carry a theme with it.
  const out = validateLook({ palette: 'bureau' });
  assert.deepEqual(out.value, { palette: 'bureau' });
  assert.equal(validateLook({}).ok, false);
});

/* ------------------------------------------------------------------ */
group('The Client-First layer');

// public/client-first.css is the vocabulary screens are rebuilt out of:
// structure, spacing, typography and a few components, named the way
// Finsweet's Client-First convention names them. It is allowed to hold no
// design decisions of its own, and these are the checks that keep it that
// way. They are the same two rules the palette and theme axes rest on,
// applied to a second file.
const cfCss = fs.readFileSync(new URL('../public/client-first.css', import.meta.url), 'utf8');
// Comments carry hex values in their explanations; only the rules are checked.
const cfRules = cfCss.replace(/\/\*[\s\S]*?\*\//g, '');

test('IT NAMES NO COLOUR — every colour it uses is a palette token', () => {
  // A hex or an rgb in here would be a colour that survives a palette
  // change, which is the one thing a palette is for.
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(cfRules), 'a rule names a hex colour');
  assert.ok(!/\brgba?\(/i.test(cfRules), 'a rule names an rgb colour');
  assert.ok(!/\bhsla?\(/i.test(cfRules), 'a rule names an hsl colour');
  // Named colours too: `red` is as permanent as `#ff0000`.
  assert.ok(!/:\s*(red|blue|green|black|white|grey|gray)\b/i.test(cfRules),
    'a rule names a colour by name');
});

test('and no font family, radius or page width of its own — those are the theme’s', () => {
  for (const decl of cfRules.match(/font-family:[^;}]+/gi) || []) {
    assert.match(decl, /var\(--(sans|cond|mono)/, `a rule picks its own face: ${decl}`);
  }
  for (const decl of cfRules.match(/border-radius:[^;}]+/gi) || []) {
    assert.match(decl, /var\(--radius/, `a rule picks its own radius: ${decl}`);
  }
  // The widest container is the theme's measure, not a number chosen here.
  assert.match(cfCss, /--size--container-large:\s*var\(--page-max/);
});

test('every token it reads is one the page actually defines', () => {
  // A var() naming a token nothing declares is a rule that silently does
  // nothing — or, with a fallback, one that silently ignores the palette.
  const declared = new Set([...lookHtml.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  for (const m of cfCss.matchAll(/(--[a-z0-9-]+)\s*:/g)) declared.add(m[1]);
  const used = new Set([...cfRules.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  for (const token of used) {
    assert.ok(declared.has(token), `${token} is read but never declared`);
  }
});

test('and so is every token the PAGE\u2019S OWN rules read', () => {
  // THE CHECK ABOVE ONLY READ client-first.css, which is how three of these
  // shipped: the Style preview asked for --ink2 (the token is --ink-2) and
  // --on-act (the real button reads --act-fg). A var() naming nothing resolves
  // to nothing, so the text and the button face simply inherited — and the
  // preview's whole job is to show what a palette will actually look like, so
  // it was wrong about the one thing it exists to answer.
  //
  // A FALLBACK IS ALLOWED and is not counted. `var(--navh,52px)` is a layout
  // constant with a default, which works as written; it is only the
  // fallback-less ones that silently do nothing.
  const declared = new Set([...lookHtml.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  for (const m of cfCss.matchAll(/(--[a-z0-9-]+)\s*:/g)) declared.add(m[1]);
  for (const m of pageCss.matchAll(/(--[a-z0-9-]+)\s*:/g)) declared.add(m[1]);
  const missing = [];
  for (const [, token] of pageCss.matchAll(/var\((--[a-z0-9-]+)\s*\)/g)) {
    if (!declared.has(token)) missing.push(token);
  }
  assert.deepEqual([...new Set(missing)], [], 'read but never declared');
});

test('every form_ class the markup wears has a rule somewhere that loads', () => {
  /* THE SAME FAULT AS THE TOKEN CHECKS ABOVE, one level up: a class that
     names no rule does nothing, silently, and looks completely intentional
     in the markup.

     `form_label-sep` was worn by 22 section headings across the admin and
     styled in no stylesheet the app loads. page.css had
     `.form_label.lab-sep`, from before the class was renamed — a dead rule
     cannot object to being orphaned — so every "What the colour shows" and
     "Where it appears" rendered as a plain body paragraph with no space
     above it. Found by looking at the heat-map editor on a phone, which is
     not a way of finding things.

     Scoped to the `form_` family on purpose: it is one vocabulary, it is
     all in client-first.css, and a check that tried to do this for every
     class in the application would be matching utility names from a
     framework and would get turned off within the week. */
  const sources = [indexHtml, ...fs.readdirSync(new URL('../public/js', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => readPublic(`js/${f}`))].join('\n');
  const css = `${cfCss}\n${pageCss}`;
  const used = new Set();
  for (const m of sources.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c.startsWith('form_')) used.add(c);
  }
  assert.ok(used.size > 5, 'the markup scan found almost nothing — it has stopped working');
  const unstyled = [...used].filter((c) => !css.includes(`.${c}`));
  assert.deepEqual(unstyled, [],
    'worn in the markup and styled in no stylesheet the page loads');
});

test('nothing in it styles a bare element, so adding it changed no screen', () => {
  // The file was loaded before a single screen used it. That is only safe
  // because every selector in it is a class: one element selector and it
  // would have repainted the whole site the day it landed. The one
  // deliberate exception is prose inside .text-rich-text.
  const selectors = cfRules
    .split('}')
    .map((chunk) => (chunk.includes('{') ? chunk.slice(0, chunk.indexOf('{')) : ''))
    .flatMap((sel) => sel.split(','))
    .map((sel) => sel.trim())
    .filter((sel) => sel && !sel.startsWith('@'));
  assert.ok(selectors.length > 60, `only ${selectors.length} selectors found; the split is wrong`);
  for (const sel of selectors) {
    if (sel === ':root') continue;
    assert.match(sel, /^[.[:]/, `a bare element is styled: ${sel}`);
  }
});

test('the page loads the look first and the layer last', () => {
  // Order is load-bearing twice over: the layer reads tokens the look
  // declares, and a utility class has to beat a component's own rule.
  //
  // The middle used to be a <style> block and is six files now, so this
  // reads the LINK ORDER rather than looking for the block. The page's own
  // rules all have to sit between the two, and there has to be at least one
  // of them \u2014 a page linking none would satisfy a pair of inequalities.
  //
  // MEASURED WITH THE COMMENTS STRIPPED, the same care the inline-rules check
  // below takes and for the same reason: these are bare `indexOf` positions,
  // so a comment anywhere above the links that happens to name a stylesheet
  // is read as the link itself and the file appears to load before the look.
  // The boot gate's comment at the top of the page names one, which is how
  // this was found.
  const markup = indexHtml.replace(/<!--[\s\S]*?-->/g, '');
  const look = markup.indexOf('/tokens.css');
  const layer = markup.indexOf('/client-first.css');
  assert.ok(look !== -1 && layer !== -1, 'a stylesheet is not linked at all');
  assert.ok(LINKED_CSS.length > 0, 'the page links none of its own rules');
  for (const f of LINKED_CSS) {
    const at = markup.indexOf(`/${f}`);
    assert.ok(at > look, `${f} is loaded before the look`);
    assert.ok(at < layer, `${f} is loaded after the layer`);
  }
});

test('and the page keeps no rules and no code of its own inline', () => {
  // Not tidiness. nginx serves this file off disk, so a nonce is not
  // available to it, and one inline <script> would mean any
  // Content-Security-Policy the deployment sets has to allow
  // 'unsafe-inline' \u2014 which is most of what a CSP is for. The service
  // worker registration lives in public/js/sw-register.js for this reason.
  // Comments first: the comment above the stylesheet links says the words
  // "<style> block", and a grep that reads a comment as markup fails for a
  // reason that has nothing to do with the page.
  const markup = indexHtml.replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(markup, /<style[\s>]/, 'the page carries an inline stylesheet again');
  const scripts = [...markup.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  for (const attrs of scripts) {
    assert.match(attrs, /\ssrc="/, `an inline <script> is back: <script${attrs}>`);
    assert.match(attrs, /type="module"/, `a script is not a module: <script${attrs}>`);
  }
  assert.ok(scripts.length > 1, 'the page loads no code at all');
});

test('and NO shipped page carries an inline <style> either', () => {
  // Missed the first time round: the inline-script check only ever looked at
  // index.html, so api.html, app.html, docs.html and styleguide.html kept a
  // <style> block each and a real browser refused all four under
  // style-src-elem. A grep that covers one page is a grep that covers one
  // page.
  for (const page of SHIPPED_PAGES_ALL) {
    const markup = readPublic(page).replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(markup, /<style[\s>]/, `${page} carries an inline <style> block`);
  }
});

test('and NO shipped page does, which is what makes the policy possible', () => {
  // The app's page is not the only one nginx serves. api.html, app.html and
  // styleguide.html each carried an inline <script> too, and one of them is
  // enough to force 'unsafe-inline' on the whole deployment. The two brand
  // painters were byte-identical, so they are one file now.
  for (const page of SHIPPED_PAGES_ALL) {
    const markup = readPublic(page).replace(/<!--[\s\S]*?-->/g, '');
    for (const [, attrs] of markup.matchAll(/<script\b([^>]*)>/g)) {
      assert.match(attrs, /\ssrc="/, `${page} has an inline <script${attrs}>`);
    }
  }
});

test('the policy is stated, and states script-src without unsafe-inline', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const csp = server.match(/const CSP = \[([\s\S]*?)\]\.join/);
  assert.ok(csp, 'server.js no longer states a Content-Security-Policy');
  const directives = [...server.matchAll(/^  "([^"]+)",$/gm)].map((m) => m[1]);
  const only = (name) => directives.filter((d) => d.startsWith(`${name} `));
  // script-src is the one that must be strict. No inline, no eval, ever.
  assert.deepEqual(only('script-src'), ["script-src 'self'"]);
  // Style: 'self' alone. No 'unsafe-inline' anywhere, so an injected <style>,
  // a third-party stylesheet and an inline style="" attribute are all refused.
  // That is affordable only because the markup carries no such attribute —
  // asserted separately below, and it is the assertion to look at first if
  // this one is ever relaxed.
  assert.deepEqual(only('style-src'), ["style-src 'self'"]);
  for (const d of directives) {
    assert.doesNotMatch(d, /unsafe-inline|unsafe-eval/, `a permissive directive: ${d}`);
  }
  // The directives that cost nothing and were verified against the markup:
  // there is no <object>, no <base>, no iframe and no cross-origin form.
  for (const d of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
    assert.ok(csp[1].includes(d), `${d} is no longer in the policy`);
  }
  // Deliberately absent: naming the deployment's bucket is not possible here.
  assert.doesNotMatch(csp[1], /default-src|img-src|connect-src/,
    'a directive was added that has to know where this deployment stores files');
});

test('and no page, module or script string carries an inline style attribute', () => {
  // The other half of `style-src 'self'`. A style="" in markup is refused by
  // the browser and does nothing, silently, which is why this looks for it
  // before a browser does. Setting a property through the CSSOM
  // (el.style.width = ...) is allowed and is how a script does it.
  for (const page of SHIPPED_PAGES_ALL) {
    assert.doesNotMatch(readPublic(page), /\sstyle\s*=\s*["']/i,
      `${page} carries an inline style attribute, which the policy refuses`);
  }
  for (const f of LINKED_JS.concat(['js/styleguide.js', 'js/static-page-brand.js',
    'js/docs-page.js'])) {
    assert.doesNotMatch(readPublic(f), /\sstyle\s*=\s*\\?["']|setAttribute\(\s*['"]style['"]/,
      `${f} writes a style attribute, which the policy refuses \u2014 set it through the CSSOM`);
  }
});

test('an element the markup hides with `hidden` is never shown by clearing style.display', () => {
  // The two mechanisms do not talk to each other. `el.style.display = ''` on an
  // element that is hidden by the attribute changes nothing, so the screen
  // stays blank and nothing throws. It is the failure the conversion away from
  // style="display:none" could most easily have left behind.
  const html = readPublic('index.html');
  const ids = [...html.matchAll(/<[a-z0-9]+\b[^>]*\bid="([^"]+)"[^>]*\shidden\b/g)].map((m) => m[1]);
  assert.ok(ids.length > 10, 'found too few hidden elements to be checking anything');
  for (const f of LINKED_JS) {
    const src = readPublic(f);
    for (const id of ids) {
      assert.doesNotMatch(src, new RegExp(`getElementById\\(\\s*['"]${id}['"]\\s*\\)\\.style\\.display`),
        `${f} shows or hides #${id} with style.display, but the markup hides it with the hidden attribute`);
    }
  }
});

test('and nothing in the frontend creates a stylesheet, which is why it can', () => {
  // style-src-elem 'self' refuses a <style> element whoever made it,
  // including us. This is the check that says so before a browser does.
  for (const f of LINKED_JS.concat(['js/styleguide.js', 'js/static-page-brand.js'])) {
    const src = readPublic(f);
    assert.doesNotMatch(src, /createElement\(\s*['"]style['"]/,
      `${f} builds a <style> element, which the policy refuses`);
    assert.doesNotMatch(src, /\.cssText|insertRule/,
      `${f} writes a stylesheet at runtime, which the policy refuses`);
  }
  for (const page of SHIPPED_PAGES_ALL) {
    for (const [, href] of readPublic(page).matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)) {
      assert.match(href, /^\//, `${page} loads a stylesheet from off-origin: ${href}`);
    }
  }
});

test('and nginx states the same one, because it answers for public/ in production', () => {
  // The split that matters, again: nginx serves public/ off disk, so a policy
  // only this process sets is a policy production does not send. Two copies of
  // a security header drifting apart is worse than one.
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const directives = [...server.matchAll(/^  "([^"]+)",$/gm)].map((m) => m[1]);
  assert.ok(directives.length >= 5, 'could not read the directives out of server.js');
  const conf = fs.readFileSync(new URL('../contrib/nginx/reportlog.conf', import.meta.url), 'utf8');
  const snippet = fs.readFileSync(new URL('../contrib/nginx/csp.conf', import.meta.url), 'utf8');
  // The policy is written once, in csp.conf, and included. Two includes: an
  // add_header inside a location REPLACES the server-level ones, so
  // = /sw.js needs its own. A pasted string here would bring back the hand
  // edit on every release that changes the policy.
  assert.ok(!/add_header Content-Security-Policy/.test(conf),
    'reportlog.conf states the policy itself \u2014 it must include csp.conf instead');
  const includes = [...conf.matchAll(/^\s*include \S*\/contrib\/nginx\/csp\.conf;/gm)];
  assert.ok(includes.length >= 2,
    'nginx includes the policy fewer than twice \u2014 an add_header inside a location '
    + 'REPLACES the server-level ones, so = /sw.js needs its own include');
  // The file must be comments plus exactly one complete directive. A bare
  // `add_header` left on a line by an edit passes every regex below and makes
  // nginx refuse to load, which is how this got to a box.
  const code = snippet.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  assert.equal(code.length, 1, `csp.conf must hold exactly one directive, found ${code.length}`);
  assert.match(code[0], /^add_header Content-Security-Policy "[^"]+" always;$/,
    'csp.conf\u2019s one directive is not a complete add_header with a quoted value and `always;`');
  const headers = [...snippet.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)].map((m) => m[1]);
  assert.equal(headers.length, 1, 'csp.conf must state the policy exactly once');
  assert.equal(headers[0], directives.join('; '), 'nginx and server.js disagree about the policy');
  // The value itself is full of semicolons, so the match has to run to the
  // closing quote before looking for `always`.
  for (const h of [...snippet.matchAll(/add_header Content-Security-Policy "[^"]+"[^;]*;/g)].map((m) => m[0])) {
    assert.match(h, /\salways;$/, 'the policy is dropped on error responses without `always`');
  }
});

test('and the service worker precaches everything the page asks for', () => {
  // The SHELL list was written by hand and the page's needs grew past it
  // twice. This reads what the page actually links and checks each one is
  // precached, so the list cannot fall behind again.
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  for (const f of [...LINKED_CSS, ...LINKED_JS]) {
    assert.ok(sw.includes(`'/${f}'`), `/${f} is not in the precached shell`);
  }
  // And nothing precached has since been deleted or renamed.
  for (const [, f] of sw.matchAll(/'\/((?:css|js)\/[a-z-]+\.(?:css|js))'/g)) {
    assert.ok(fs.existsSync(new URL(`../public/${f}`, import.meta.url)),
      `the shell precaches /${f}, which does not exist`);
  }
});

test('and the service worker ships both stylesheets with the page', () => {
  // A shell served from the cache without them draws unstyled. The cache
  // version is not asserted here — a test pinning the number just gets
  // bumped along with it — but sw.js names both files where it says to bump.
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  for (const f of ["'/tokens.css'", "'/client-first.css'"]) {
    assert.ok(sw.includes(f), `${f} is not in the precached shell`);
  }
  const bumpNote = sw.slice(0, sw.indexOf('const CACHE'));
  for (const f of ['public/tokens.css', 'public/client-first.css']) {
    assert.ok(bumpNote.includes(f), `${f} is not named where the cache bump is explained`);
  }
});

test('and the service worker never prefers a cached script or stylesheet', () => {
  // Scripts and styles were cache-first and fresh only when somebody bumped
  // CACHE. Nobody did for 37 commits, and an installed browser ran week-old
  // JavaScript under new HTML. The fall-through branch — what /js and /css
  // reach — must go to the network before the cache.
  const sw = stripComments(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'));
  const iconsAt = sw.indexOf("startsWith('/icons/')");
  assert.ok(iconsAt > 0, 'the icons branch is gone');
  const tail = sw.slice(sw.indexOf('return;', iconsAt) + 'return;'.length);
  // fetch(req, { cache: 'no-cache' }): the server, never the browser's own
  // guess at freshness — a stale module beside new ones left a white page.
  assert.match(tail, /fetch\(req, \{ cache: 'no-cache' \}\)/,
    'scripts and styles must revalidate with the server, not trust the browser cache');
  const net = tail.indexOf('fetch(req');
  const cached = tail.indexOf('caches.match(');
  assert.ok(net >= 0 && cached > net,
    'scripts and styles must be fetched from the network first and the cache only as the fallback');
  assert.match(tail, /\.catch\(\s*\(\)\s*=>\s*caches\.match\(/,
    'the cache is reached only when the network fails');
  // And the icons stay cache-first: they are the one thing staleness costs nothing.
  assert.match(sw.slice(iconsAt, iconsAt + 300), /caches\.match\(req\)\.then\(\(hit\) => hit \|\| fetch\(req\)\)/);
});

test('the browser suite that plants a stale cache is actually run', () => {
  // Every browser run starts with an empty profile, which is exactly why the
  // stale-cache bug was invisible. The suite that seeds one must stay wired in.
  const run = fs.readFileSync(new URL('../tools/browser-tests/run.js', import.meta.url), 'utf8');
  assert.match(run, /import serviceWorker from '\.\/service-worker\.test\.js'/);
  assert.match(run.slice(run.indexOf('const SUITES')), /^const SUITES = \[[^\]]*\bserviceWorker\b/);
});

test('a failed update says when it failed', () => {
  // An undated failure from before a manual deploy read as the state of the
  // box now. The pane must print the time it recorded.
  const js = fs.readFileSync(new URL('../public/js/admin-updates.js', import.meta.url), 'utf8');
  const branch = js.slice(js.indexOf("status.state === 'failed'"), js.indexOf('!st.hasUpdate'));
  assert.match(branch, /status\.at/, 'the failed line does not read the recorded time');
  assert.match(branch, /The update attempted\$\{stamp\} failed/);
});

test('a deploy by hand records itself where the Updates pane looks', () => {
  // Otherwise the pane goes on showing whatever the button last recorded —
  // a failure, after the box was updated past it. Written after the
  // migration succeeds (a failed one hits `fail`, which exits) and before
  // the restart, so the restarted server reads it.
  const sh = fs.readFileSync(new URL('../contrib/deploy.sh', import.meta.url), 'utf8');
  const mig = sh.indexOf('say "Migrating"');
  const status = sh.indexOf('var/update-status.json');
  const restart = sh.indexOf('say "Restarting');
  assert.ok(mig > 0 && status > mig && restart > status,
    'deploy.sh must write var/update-status.json between migrating and restarting');
  assert.match(sh, /"state":"done"/);
});

test('a tap target is never smaller than a finger', () => {
  // 2.75rem is 44px at the default root size: the smallest target iOS and
  // Android both call reachable. Every control in the layer states it.
  assert.match(cfCss, /--size--tap:2\.75rem/);
  for (const cls of ['.button{', '.form_input,', '.choice_item{']) {
    assert.ok(cfCss.includes(cls), `${cls} is missing from the layer`);
  }
});

/* ------------------------------------------------------------------ */
group('Three permissions a reporter can take back');

// The feature itself is a projection over an append-only log and is tested
// against a real database in scripts/permissions-selftest.mjs. What belongs
// HERE is the part that would damage the archive if it were ever wrong.

const perms = await import('../src/reportPermissions.js');

test('neither permission is granted until somebody grants it', () => {
  // No DEFAULT on the table and no backfill, so every thread filed before
  // this feature reads as never-granted. This is the shape that fallback
  // takes, written once so no caller invents its own.
  for (const p of perms.PERMISSIONS) assert.equal(perms.NONE_GRANTED[p], false);
  assert.ok(Object.isFrozen(perms.NONE_GRANTED),
    'a shared default that can be mutated is a default that will be');
});

test('only these three names are permissions', () => {
  // Pinned rather than counted, because the list is a deliberate set and a
  // fourth should be a decision somebody made rather than an import that
  // compiled.
  assert.deepEqual(perms.PERMISSIONS,
    ['contact_passing', 'attachment_publication', 'evidence_request']);
  assert.ok(perms.isPermission('contact_passing'));
  assert.ok(!perms.isPermission('may_publish'),
    'may_publish is the sealed answer given at filing, not a revocable permission');
  assert.ok(!perms.isPermission('publish_my_identity'),
    'publishing identity is not on offer at all');
  // THE DECLARATION IS NOT A PERMISSION. What somebody said they had at
  // filing is a sealed answer to a logbook's question; whether they will be
  // contacted about it is this log's business. Conflating them would put a
  // revocable value in the fingerprint.
  assert.ok(!perms.isPermission('has_evidence'),
    'what a reporter said they had is a sealed answer, not a revocable grant');
});

test('and NOTHING that computes a fingerprint can see them', () => {
  // The one that must never go red. These values exist to change; a hashed
  // key must never change. If the chain could read them, a report would
  // verify differently after a reporter changed their mind.
  //
  // THE SAME BAN NOW COVERS EDITORIAL NOTES, for the same reason one rung
  // along: a note exists to be correctable, so a report that hashed one
  // would verify differently after an editor fixed a sentence. The archive's
  // own speech is not part of the reporter's record.
  for (const f of ['reportCore.js', 'verify.js', 'chainFile.js', 'snapshot.js']) {
    const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /reportPermissions|contact_passing|attachment_publication/,
      `${f} can see a revocable permission`);
    assert.doesNotMatch(src, /editorialNotes|editorial_note/,
      `${f} can see an editorial note — a report would verify differently after a correction`);
  }
});

test('the migration adds a table and touches nothing that exists', () => {
  const raw = fs.readFileSync(new URL('../migrations/030_report_permissions.sql', import.meta.url), 'utf8');
  // Comments out first. This file explains at length why a mutable flag is
  // impossible, so it says the word UPDATE a dozen times in prose, and
  // `BEFORE DELETE OR UPDATE ON` is the guard itself rather than a write.
  const m = raw.replace(/--[^\n]*/g, '');
  // Additive, and provably so: no backfill, and nothing added to `reports`,
  // which is where a new column would change how a report hashes.
  assert.doesNotMatch(m, /(^|;)\s*UPDATE\s/i, 'the migration rewrites rows');
  assert.doesNotMatch(m, /(^|;)\s*(INSERT|DELETE)\s/i, 'the migration writes rows');
  assert.doesNotMatch(m, /ALTER TABLE\s+reports\b/i, 'the migration alters reports');
  assert.doesNotMatch(m, /DEFAULT\s+(true|false)/i,
    'a default would switch a behaviour on everywhere the moment it ran — see 003');
  assert.match(raw, /CREATE TRIGGER[\s\S]*BEFORE DELETE OR UPDATE[\s\S]*reject_modification/,
    'the log is not append-only');
  assert.match(raw, /BEFORE TRUNCATE/,
    'a row trigger does not fire for TRUNCATE — see migration 007');
});

test('every route that feeds a report card returns the attachment counts', () => {
  // Found the hard way. The reporter's own list did NOT return
  // attachment_published_count, so the confirmation before taking published
  // files down — which reads it — could never fire, and the browser test
  // could not see that because it mocks the endpoint. A mocked payload proves
  // the page handles a shape; only this proves the server sends it.
  const reads = fs.readFileSync(new URL('../public/js/board.js', import.meta.url), 'utf8')
    + fs.readFileSync(new URL('../public/js/mine.js', import.meta.url), 'utf8');
  assert.match(reads, /attachment_published_count/,
    'nothing reads the count any more — this check can be deleted');
  for (const f of ['me.js', 'reports.js', 'moderators.js']) {
    const src = fs.readFileSync(new URL(`../src/routes/${f}`, import.meta.url), 'utf8');
    assert.match(src, /attachmentColumns\(\)/,
      `${f} serves report cards without the attachment counts they read`);
  }
});

test('a moderator has no route that writes the log', () => {
  // Reporter-initiated, always: a moderator granting a permission on
  // somebody's behalf would record the operator's decision under the
  // reporter's name. moderators.js may READ the projection — it has to, to
  // honour the ceiling when publishing a file — and may never write it.
  const mod = fs.readFileSync(new URL('../src/routes/moderators.js', import.meta.url), 'utf8');
  assert.doesNotMatch(mod, /setPermission/, 'a moderator route writes a reporter permission');
  assert.match(mod, /permissionsFor/, 'the publication route no longer reads the ceiling');
});

/* ------------------------------------------------------------------ */
group('The frontend is modules, and no build step');

// The page was one 6,540-line <script> in a closure. It is twenty-two ES
// modules the browser loads itself. There is NO BUNDLER and there must not
// be one — these checks are what stands in for the one a build step would
// have done for us.

const MODULES = new Map(LINKED_JS.map((f) => [f.replace(/^js\//, ''), readPublic(f)]));

test('the checks that read the frontend are reading something', () => {
  // Everything above that used to grep index.html for a rule or a function
  // now greps a file discovered from the page. If that discovery ever breaks,
  // a dozen checks quietly start passing against an empty string. This is the
  // assertion that notices, and it is why it states sizes rather than shapes.
  assert.ok(pageCss.length > 20000, `the page's own rules read as ${pageCss.length} bytes`);
  assert.ok(pageJs.length > 150000, `the page's own code reads as ${pageJs.length} bytes`);
  assert.ok(LINKED_CSS.length >= 4, `only ${LINKED_CSS.length} stylesheets found`);
  assert.ok(LINKED_JS.length >= 10, `only ${LINKED_JS.length} modules found`);
});

test('every file in public/js/ is loaded by a page, and every page has its files', () => {
  // Both directions. A file nobody loads is dead code; a file a page names and
  // that does not exist is a 404 and, for a module, a blank screen.
  const onDisk = fs.readdirSync(new URL('../public/js', import.meta.url)).filter((f) => f.endsWith('.js'));
  const referenced = new Set();
  for (const page of SHIPPED_PAGES_ALL) {
    for (const [, src] of readPublic(page).matchAll(/<script\b[^>]*\ssrc="\/js\/([a-z-]+\.js)"/g)) {
      assert.ok(onDisk.includes(src), `${page} loads /js/${src}, which does not exist`);
      referenced.add(src);
    }
  }
  assert.deepEqual(onDisk.filter((f) => !referenced.has(f)), [],
    'these files in public/js/ are loaded by no page');
  // And the app's own modules are all of them the page lists.
  for (const m of MODULES.keys()) assert.ok(onDisk.includes(m), `${m} is listed but missing`);
});

test('every import names a file that exists and exports that name', () => {
  // The one thing a bundler would have caught for free. A wrong name here is
  // a blank screen, and it is the most likely way this split rots.
  for (const [name, src] of MODULES) {
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, names, from] of body.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([a-z-]+\.js)'/g)) {
      assert.ok(MODULES.has(from), `${name} imports from ./${from}, which is not a module`);
      const exported = MODULES.get(from).match(/\nexport \{([\s\S]*?)\n\};/);
      assert.ok(exported, `${name} imports from ./${from}, which exports nothing`);
      const available = exported[1].split(',').map((s) => s.trim()).filter(Boolean);
      for (const want of names.split(',').map((s) => s.trim()).filter(Boolean)) {
        assert.ok(available.includes(want),
          `${name} imports ${want} from ./${from}, which does not export it`);
      }
    }
  }
});

test('and no module declares the same thing twice', () => {
  // A whole stanza of the first-run setup section had been pasted twice, so
  // there were two identical afterUnlock declarations. In the old sloppy-mode
  // closure the second silently won and nothing anywhere said so; in a module
  // it is a SyntaxError and the screen is blank. This is the check that says
  // which, before a browser has to.
  for (const [name, src] of MODULES) {
    const seen = new Map();
    src.split('\n').forEach((line, i) => {
      const m = /^(?:function|var|let|const|class)\s+([A-Za-z_$][\w$]*)/.exec(line);
      if (!m) return;
      if (seen.has(m[1])) {
        assert.fail(`${name} declares ${m[1]} at both line ${seen.get(m[1])} and line ${i + 1}`);
      }
      seen.set(m[1], i + 1);
    });
  }
});

test('nothing reaches for the global object except the two things that must', () => {
  // The closure is gone, so anything written onto window now is a deliberate
  // export rather than an accident of scope. There are two: STEPS, which the
  // browser suite reads to count the form's cards, and howtocLabel.
  const allowed = new Set(['STEPS', 'howtocLabel']);
  for (const [name, src] of MODULES) {
    for (const [, prop] of src.matchAll(/(?:^|[^.\w])window\.([A-Za-z_$][\w$]*)\s*=/g)) {
      assert.ok(allowed.has(prop),
        `${name} writes window.${prop} — a module should export it instead`);
    }
  }
});

test('and no module is a build artefact', () => {
  for (const [name, src] of MODULES) {
    assert.doesNotMatch(src, /sourceMappingURL/, `${name} carries a source map`);
    assert.doesNotMatch(src, /^\s*(?:import|export)[^\n]*from\s*'[^.]/m,
      `${name} imports from somewhere other than a file beside it`);
  }
});

/* ------------------------------------------------------------------ */
group('The name in up to three tones');

const marks = (raw) => parseBrand(raw).map((p) => p.mark + ':' + p.text).join('|');

test('a name with no quotes is one colour, exactly as it always was', () => {
  assert.deepEqual(parseBrand('Munich Incident Archive'),
    [{ text: 'Munich Incident Archive', mark: '' }]);
  assert.equal(isMarked('Munich Incident Archive'), false);
  assert.equal(plainName('Munich Incident Archive'), 'Munich Incident Archive');
});

test('double quotes mark the first accent, single quotes the second', () => {
  assert.equal(marks('Report"Log"'), ':Report|a:Log');
  assert.equal(marks('"Munich"Archive'), 'a:Munich|:Archive');
  assert.equal(marks("Munich'Log'"), ':Munich|b:Log');
});

test('a name may use both, and they may repeat', () => {
  // Two accents was the point of the second quote kind. Nothing here caps
  // the count: the palette provides two colours and a name may spend them
  // as often as it likes.
  assert.equal(marks(`The"Ruhr"Line'.org'`), ':The|a:Ruhr|:Line|b:.org');
  assert.equal(marks('A"B"C"D"'), ':A|a:B|:C|a:D');
});

test('the quotes are never part of the name', () => {
  // A mail subject, a browser tab and an Impressum all want words. Only the
  // rendered brand wants the runs.
  assert.equal(plainName('Report"Log"'), 'ReportLog');
  assert.equal(plainName("Munich'Archive'"), 'MunichArchive');
  assert.equal(plainName(`The"Ruhr"Line'.org'`), 'TheRuhrLine.org');
});

test('an apostrophe is a character, not a mark', () => {
  // This is the one that would have hurt. A single quote is now syntax AND
  // the commonest punctuation mark in a name. A lone apostrophe that does
  // not close must survive into the rendered name rather than swallowing
  // half of it, so an unclosed kind of quote is dropped from the syntax and
  // re-read as text.
  assert.deepEqual(parseBrand("Munich's Log"), [{ text: "Munich's Log", mark: '' }]);
  assert.equal(plainName("Munich's Log"), "Munich's Log");
  // And inside a double-quoted accent it is simply a character.
  assert.equal(marks(`The"O'Brien"Log`), ":The|a:O'Brien|:Log");
});

test('a name whose quotes do not close renders flat rather than mangled', () => {
  // Half a marked name is somebody mid-keystroke. Drawing the rest of it in
  // the accent colour would make a typo look like a decision.
  assert.equal(plainName('un"balanced'), 'un"balanced');
  assert.equal(isMarked('un"balanced'), false);
  assert.equal(plainName(`bad"and'both`), 'badandboth');
});

test('never returns an empty list, so no caller needs a special case', () => {
  for (const raw of ['', null, undefined, '""', '"', "'"]) {
    const parts = parseBrand(raw);
    assert.ok(Array.isArray(parts) && parts.length >= 1, JSON.stringify(raw));
  }
});

test('the field warns about an unclosed double quote and not about an apostrophe', () => {
  // The asymmetry is deliberate. A double quote is unambiguous syntax and
  // an unclosed one is a typo. A single quote is an apostrophe first —
  // refusing `Sam's Archive` would have been a real regression, and this
  // is what stops it coming back.
  assert.equal(accentMarksClose('Report"Log"'), true);
  assert.equal(accentMarksClose(`The"Ruhr"Line'.org'`), true);
  assert.equal(accentMarksClose('Report"Log'), false);
  assert.equal(accentMarksClose("Munich's Log"), true);
  assert.equal(validateSiteName("Sam's Archive").ok, true);
  assert.equal(validateSiteName("O'Brien's Incident Log").ok, true);
  assert.equal(validateSiteName('Report"Log').ok, false);
  assert.equal(validateSiteName('Report"Log"').ok, true);
});

test('the browser and the server split a name the same way', () => {
  // The wizard draws the name as it is typed, before anything is saved, so
  // it carries its own copy of this parser. Two implementations of one rule
  // is how they come to disagree — this runs the same table through both.
  const fn = pageJs.match(/function setupParseBrand\(raw\)\{[\s\S]*?\n\}/);
  assert.ok(fn, 'the wizard no longer carries its own parser');
  // eslint-disable-next-line no-new-func
  const browser = new Function(fn[0] + '; return setupParseBrand;')();
  for (const raw of [
    'ReportLog', 'Report"Log"', "Munich'Log'", `The"Ruhr"Line'.org'`,
    "Munich's Log", 'un"balanced', `bad"and'both`, '', 'A"B"C"D"', `The"O'Brien"Log`,
  ]) {
    assert.deepEqual(browser(raw), parseBrand(raw), `disagreed on ${JSON.stringify(raw)}`);
  }
});

test('an unbalanced quote is refused at the field, not rendered', () => {
  assert.equal(validateSiteName('Report"Log').ok, false);
  assert.equal(validateSiteName('Report"Log"').ok, true);
  assert.equal(validateSiteName('Munich Archive').ok, true);
});

test('the length limit counts the name, not the markup', () => {
  // Two quote characters should not cost an operator two characters of
  // their own title.
  const long = 'x'.repeat(MAX_SITE_NAME);
  assert.equal(validateSiteName(long).ok, true);
  assert.equal(validateSiteName(`"${long}"`).ok, true);
  assert.equal(validateSiteName(`x${long}`).ok, false);
});

/* ------------------------------------------------------------------ */
group('The intake switch');

// The other end of the site from the publishing switches, and independent
// of them. Both halves of that independence are asserted, because the way
// this goes wrong is somebody "tidying" one into the other.

test('nobody having decided means the form is open', () => {
  assert.equal(intakeOpen(null), true);
  assert.equal(intakeOpen({}), true);
  assert.equal(intakeOpen({ intake_enabled: null }), true);
});

test('a migration must not close a running intake', () => {
  // The whole reason the column has no DEFAULT. If this ever goes red, some
  // deployment's form went dark on the night its operator ran a migration.
  const m = fs.readFileSync(new URL('../migrations/014_intake_switch.sql', import.meta.url), 'utf8');
  const statements = m.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.ok(/ADD COLUMN IF NOT EXISTS intake_enabled boolean/.test(statements));
  assert.ok(!/DEFAULT/i.test(statements));
  assert.ok(!/\b(DROP|ALTER COLUMN|RENAME)\b/i.test(statements));
});

test('only an explicit false closes it', () => {
  assert.equal(intakeOpen({ intake_enabled: false }), false);
  assert.equal(intakeOpen({ intake_enabled: true }), true);
});

test('it is not in the hashed object, and the chain cannot see it', () => {
  for (const file of ['../src/reportCore.js', '../src/verify.js']) {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/intake_enabled|intakeGate|intakeIsOpen/.test(src), file);
  }
});

test('both doors into the chain are closed by it, not just the public one', () => {
  // A switch that shut the public form while a coordinator could still file
  // a batch of two hundred is not an intake switch.
  const web = fs.readFileSync(new URL('../src/routes/reports.js', import.meta.url), 'utf8');
  const batch = fs.readFileSync(new URL('../src/routes/intake.js', import.meta.url), 'utf8');
  assert.ok(/intakeIsOpen/.test(web), 'public form door');
  assert.ok(/intakeIsOpen/.test(batch), 'coordinator batch door');
});

/* ------------------------------------------------------------------ */
group('Nothing in the chain may read the legal text');

// Presentation, like the site's name. A report must not verify differently
// because somebody corrected their privacy policy.
test('reportCore and verify never touch the legal columns', () => {
  for (const file of ['../src/reportCore.js', '../src/verify.js']) {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/impressum|privacy_text|legalText/i.test(src), file);
  }
});

test('and migration 013 is additive only', () => {
  const raw = fs.readFileSync(new URL('../migrations/013_legal_text.sql', import.meta.url), 'utf8');
  // The comments explain why there is no DEFAULT and say the word while
  // doing it, so the statements are what gets read here.
  const m = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.ok(/ADD COLUMN IF NOT EXISTS impressum_text/.test(m));
  assert.ok(/ADD COLUMN IF NOT EXISTS privacy_text/.test(m));
  // A DEFAULT here would have published the outline as every deployment's
  // own legal notice the moment this ran.
  assert.ok(!/DEFAULT/i.test(m));
  assert.ok(!/\b(DROP|ALTER COLUMN|RENAME)\b/i.test(m));
});

/* ------------------------------------------------------------------ */
group('Setup cannot be reopened on a live deployment');

// Migration 008 is the thing standing between this feature and a wizard
// appearing on a running archive, so it is asserted rather than trusted.

const setupMigration = fs.readFileSync(
  new URL('../migrations/008_first_run_setup.sql', import.meta.url), 'utf8');

test('the migration marks an existing deployment already set up', () => {
  assert.match(setupMigration, /UPDATE site_settings[\s\S]*SET setup_completed_at = now\(\)/);
  assert.match(setupMigration, /EXISTS \(SELECT 1 FROM users WHERE role = 'admin'\)/);
});

test('and it is additive, like every migration after 001', () => {
  assert.doesNotMatch(setupMigration, /\bDROP\b|\bDELETE\b/i);
});

/* ------------------------------------------------------------------ */
group('The publication switches');

// Two delivery-layer settings. The whole point of them is what NULL means,
// and the two columns mean opposite things by NULL on purpose.

test('an untouched deployment publishes its archive', () => {
  // NULL is what every existing deployment has. Resolving it to OFF would
  // empty a running board the moment migration 009 ran.
  assert.equal(publicArchiveEnabled(null), true);
  assert.equal(publicArchiveEnabled({}), true);
  assert.equal(publicArchiveEnabled({ public_archive_enabled: null }), true);
});

test('and an untouched deployment distributes nothing', () => {
  // The opposite default, deliberately. Nothing may start distributing
  // because a migration ran.
  assert.equal(distributionEnabled(null), false);
  assert.equal(distributionEnabled({}), false);
  assert.equal(distributionEnabled({ distribution_enabled: null }), false);
});

test('an operator switching the archive off is honoured', () => {
  assert.equal(publicArchiveEnabled({ public_archive_enabled: false }), false);
});

test('and switching distribution on is the only way it turns on', () => {
  assert.equal(distributionEnabled({ distribution_enabled: true }), true);
  assert.equal(distributionEnabled({ distribution_enabled: false }), false);
});

test('neither switch is fooled by a value that is not a boolean', () => {
  // A column read back as a string, or a body field that arrived as one,
  // must not read as "on" because it is truthy.
  assert.equal(distributionEnabled({ distribution_enabled: 'true' }), false);
  assert.equal(publicArchiveEnabled({ public_archive_enabled: 'false' }), false);
});

/* ------------------------------------------------------------------ */
group('The switches stay out of the hashed object');

// The chain must not know these exist. This is the check that would catch
// somebody threading a delivery setting into the seal, which would make a
// report verify differently after an operator flipped a switch that has
// nothing to do with its contents.

const publicationMigration = fs.readFileSync(
  new URL('../migrations/009_publication_switches.sql', import.meta.url), 'utf8');

test('migration 009 touches only site_settings', () => {
  const tables = [...publicationMigration.matchAll(/ALTER TABLE (\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)], ['site_settings']);
});

test('and is additive', () => {
  assert.doesNotMatch(publicationMigration, /\bDROP\b|\bDELETE\b/i);
});

test('neither switch appears anywhere in the sealed field builders', () => {
  const core = fs.readFileSync(new URL('../src/reportCore.js', import.meta.url), 'utf8');
  const verify = fs.readFileSync(new URL('../src/verify.js', import.meta.url), 'utf8');
  for (const [name, src] of [['reportCore.js', core], ['verify.js', verify]]) {
    assert.doesNotMatch(src, /public_archive_enabled|distribution_enabled/,
      `${name} references a delivery-layer setting; the chain must not know these exist`);
  }
});

/* ------------------------------------------------------------------ */
group('The Alliance directory says what it is not');

// The name was chosen over the safer "Organizations taking part", knowing
// the objection: "Alliance" implies a membership body with shared
// commitments and a bar to clear, and no such bar exists. The disclaimer is
// the condition that decision came with. It is asserted rather than trusted
// because a sentence is the easiest thing in a codebase to quietly delete.

test('the disclaimer says listing is not verification', () => {
  assert.match(DISCLAIMER, /not verification/i);
});

test('and that no standard for verifying an organization exists yet', () => {
  assert.match(DISCLAIMER, /no standard/i);
});

test('and refuses the word that would make it an endorsement', () => {
  assert.match(DISCLAIMER, /not (an|as an) endorsement/i);
});

test('the directory keeps its chosen name', () => {
  assert.equal(DIRECTORY_NAME, 'Participating organizations');
});

/* ------------------------------------------------------------------ */
group('The listing toggle says what listing publishes');

// "List us publicly" is not an adequate question. The member count is an
// aggregate about them that did not exist before they were asked, and
// agreeing to be listed is not agreeing to publish a headcount.

test('it names all three things that appear', () => {
  const all = WHAT_APPEARS.join(' ');
  assert.match(all, /name/i);
  assert.match(all, /date/i);
  assert.match(all, /accepted an invitation/i);
});

test('and says the count is exact rather than a range', () => {
  assert.match(WHAT_APPEARS.join(' '), /exact number, not a range/i);
});

/* ------------------------------------------------------------------ */
group('The Alliance is not chained');

// Participation is mutable state about a living relationship. Sealing it
// would make an organization's membership permanently unremovable, which is
// the wrong promise for something that can end.

const allianceMigration = fs.readFileSync(
  new URL('../migrations/010_alliance_listing.sql', import.meta.url), 'utf8');

test('migration 010 touches only organizations', () => {
  const tables = [...allianceMigration.matchAll(/ALTER TABLE (\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)], ['organizations']);
});

test('and is additive', () => {
  assert.doesNotMatch(allianceMigration, /\bDROP\b|\bDELETE\b/i);
});

test('listing never reaches the sealed field builders', () => {
  const core = fs.readFileSync(new URL('../src/reportCore.js', import.meta.url), 'utf8');
  const verify = fs.readFileSync(new URL('../src/verify.js', import.meta.url), 'utf8');
  for (const [name, src] of [['reportCore.js', core], ['verify.js', verify]]) {
    assert.doesNotMatch(src, /\blisted_at\b|\borganizations\.listed\b/,
      `${name} references the listing; participation must never enter the chain`);
  }
});

test('an organization is not listed until it says so', () => {
  // DEFAULT false, not true. Listing is a claim made on an organization's
  // behalf and a migration must not make it for them.
  assert.match(allianceMigration, /listed\s+boolean NOT NULL DEFAULT false/);
});

/* ------------------------------------------------------------------ */
group('A missing media tool defers only what needs it');

// The bug: the worker asked "is anything missing?" and deferred every file
// needing any tool at all if the answer was yes. An absent pdftoppm
// deferred an MP4 on a box with working ffmpeg, and the message told the
// operator to install "media tools" without saying which.

test('a JPEG needs no external tool at all', () => {
  for (const t of TRIMMED_TYPES) {
    assert.deepEqual(missingToolsFor(t), [], `${t} should need nothing external`);
    assert.equal(canProcess(t), true);
  }
});

test('a PDF asks for the PDF tools and nothing else', () => {
  // Asserted as a set rather than by running it, so this holds on a box
  // where the tools happen to be installed and on one where they are not.
  const asked = new Set([...missingToolsFor('application/pdf'), 'pdftoppm', 'pdfinfo']);
  assert.deepEqual([...asked].sort(), ['pdfinfo', 'pdftoppm']);
});

test('and a video asks for the video tools and nothing else', () => {
  for (const t of VIDEO_TYPES) {
    const asked = new Set([...missingToolsFor(t), 'ffmpeg', 'ffprobe']);
    assert.deepEqual([...asked].sort(), ['ffmpeg', 'ffprobe'], t);
  }
});

test('no type is ever blocked by a tool for a different kind of file', () => {
  // The whole of the bug, stated once: nothing a video needs may be a PDF
  // tool, nothing a PDF needs may be a video tool, and so on.
  const families = [
    [VIDEO_TYPES, ['ffmpeg', 'ffprobe']],
    [AUDIO_TYPES, ['ffmpeg']],
    [DECODED_IMAGE_TYPES, ['heif-convert']],
    [DOCUMENT_TYPES, ['pdftoppm', 'pdfinfo']],
  ];
  for (const [types, allowed] of families) {
    for (const t of types) {
      // Every tool this type could possibly wait for must be one of its own.
      const stray = [...missingToolsFor(t), ...allowed].filter((b) => !allowed.includes(b));
      assert.deepEqual(stray, [], `${t} would wait for ${stray.join(', ')}`);
    }
  }
});

test('every allowed type is accounted for', () => {
  // A type added to ALLOWED_TYPES and forgotten here would silently be
  // treated as needing nothing, and would fail at the tool instead of
  // waiting for it — which is a rejected attachment rather than a deferred
  // one, and that is somebody's evidence.
  const needsNothing = ALLOWED_TYPES.filter((t) => !TRIMMED_TYPES.includes(t)
    && missingToolsFor(t).length === 0 && canProcess(t));
  const unmapped = needsNothing.filter((t) => {
    // On a box with the tools installed, missingToolsFor is empty for
    // everything — so ask the mapping directly instead.
    const src = fs.readFileSync(new URL('../src/media.js', import.meta.url), 'utf8');
    return !src.includes(`'${t}':`);
  });
  assert.deepEqual(unmapped, [],
    `these types have no tool mapping and would fail rather than defer: ${unmapped.join(', ')}`);
});

/* ------------------------------------------------------------------ */
group('The sweep never touches the archive');

// Four tables of short-lived secrets are deleted from once they expire.
// The danger is not that the sweep does too little; it is that a later
// version of it does too much. The archive is append-only because the
// record must be permanent, and the sweep must never learn to reach it.

test('the swept tables are the four short-lived ones', () => {
  assert.deepEqual(SWEPT.map((t) => t[0]).sort(), [
    'otp_codes', 'report_submission_tokens', 'self_sessions', 'site_access_tokens',
  ]);
});

test('and not one of them is append-only', () => {
  // appendOnlyTables is derived from the migrations further up this file.
  const overlap = SWEPT.map((t) => t[0]).filter((t) => appendOnlyTables.includes(t));
  assert.deepEqual(overlap, [],
    `the sweep would try to delete from append-only tables: ${overlap.join(', ')}`);
});

test('the sweep names its tables rather than discovering them', () => {
  // A scan for any table with an expires_at column is a rule nobody reads
  // that quietly picks up whatever matches it next. This asserts the list
  // is written down.
  const src = fs.readFileSync(new URL('../src/sweep.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /information_schema|pg_catalog|pg_tables/,
    'sweep.js discovers tables instead of naming them');
  for (const [table] of SWEPT) {
    assert.ok(src.includes(`'${table}'`), `${table} is not named in sweep.js`);
  }
});

test('every swept table really has the column the sweep filters on', () => {
  // A table renamed or a column dropped would make the sweep a statement
  // that always errors, caught and reported and never actually sweeping —
  // which looks exactly like nothing having expired.
  for (const [table] of SWEPT) {
    const create = migrationSql.match(new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`));
    assert.ok(create, `${table} has no CREATE TABLE in the migrations`);
    assert.match(create[1], /expires_at/, `${table} has no expires_at to sweep on`);
  }
});

/* ------------------------------------------------------------------ */
group('Invitations respect the role ceiling');

// Invitations are a SECOND DOOR into role granting. The ceiling exists
// because a role that can mint itself eventually becomes every role, and a
// door that skips the check is how it leaks — quietly, because nothing
// looks wrong until somebody audits it.

test('a manager can invite the organization roles', () => {
  for (const role of ORG_ROLES) {
    assert.equal(mayInvite({ actorIsManager: true, role }).ok, true, role);
  }
});

test('and nothing else, whatever it is called', () => {
  for (const role of ['moderator', 'access_manager', 'admin', 'user', '', null, undefined, 'MANAGER']) {
    assert.equal(mayInvite({ actorIsManager: true, role }).ok, false, String(role));
  }
});

test('an admin cannot use this door for a system role either', () => {
  // The invitation path is the ORGANIZATION axis. A system role granted
  // through it would bypass roles.js entirely, admin or not.
  for (const role of ['moderator', 'access_manager', 'admin']) {
    assert.equal(mayInvite({ actorIsManager: false, role }).ok, false, role);
  }
});

test('a manager inviting another manager waits for an admin', () => {
  assert.equal(mayInvite({ actorIsManager: true, role: 'manager' }).requiresApproval, true);
  assert.equal(needsApproval('manager'), true);
});

test('but inviting a coordinator does not', () => {
  assert.equal(mayInvite({ actorIsManager: true, role: 'coordinator' }).requiresApproval, false);
  assert.equal(needsApproval('coordinator'), false);
});

test('an admin does not wait for itself', () => {
  assert.equal(mayInvite({ actorIsManager: false, role: 'manager' }).requiresApproval, false);
});

/* ------------------------------------------------------------------ */
group('An invitation says what it grants');

// Nobody should discover, after clicking a link in an email, that they can
// now read restricted material.

test('every organization role has a description to show', () => {
  for (const role of ORG_ROLES) {
    const d = ROLE_DESCRIPTIONS[role];
    assert.ok(d, `${role} has no description for the accept screen`);
    assert.ok(d.label, `${role} has no label`);
    assert.ok(d.can.length > 0, `${role} says nothing about what it can do`);
    assert.ok(d.cannot.length > 0, `${role} says nothing about what it cannot do`);
  }
});

test('and nothing is described that cannot be invited', () => {
  // A description for a role the ceiling refuses would be a screen
  // promising something the code will not do.
  assert.deepEqual(Object.keys(ROLE_DESCRIPTIONS).sort(), [...ORG_ROLES].sort());
});

test('the manager description says it cannot reach outside the organization', () => {
  const cannot = ROLE_DESCRIPTIONS.manager.cannot.join(' ');
  assert.match(cannot, /outside this organization/i);
});

/* ------------------------------------------------------------------ */
group('The limits that stop invitations being a mail cannon');

// Without a decline button and with free-text addresses, an invitation is
// an unsolicited-mail vector. These were chosen deliberately; they are not
// tuning knobs.

test('fifty outstanding per organization', () => {
  assert.equal(MAX_OUTSTANDING_PER_ORG, 50);
});

test('two a day per address', () => {
  assert.equal(MAX_PER_DAY_PER_EMAIL, 2);
});

test('a link lasts seven days', () => {
  assert.equal(INVITE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});

test('migration 011 is additive and touches no report', () => {
  const sql = fs.readFileSync(
    new URL('../migrations/011_organization_invitations.sql', import.meta.url), 'utf8');
  const altered = [...sql.matchAll(/ALTER TABLE (\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(altered)], ['organization_invites']);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN/i);
  // The link is the credential; two invitations must never share one.
  assert.match(sql, /CREATE UNIQUE INDEX[\s\S]*organization_invites \(token\)/);
});

/* ------------------------------------------------------------------ */
group('The installer never asks for the keys it must not');

// TIER_B_ENCRYPTION_KEY and CONTACT_HMAC_KEY are irreplaceable: lose either
// and the data behind it is unreadable forever, ciphertext intact in every
// backup. That makes them exactly the wrong thing to prompt for — a prompt
// invites a memorable answer, a paste from a password manager, or a value
// reused from the last install.

test('both keys are 32 random bytes', () => {
  const { tierB, contactHmac } = generateSecrets();
  assert.equal(Buffer.from(tierB, 'base64').length, 32);
  assert.equal(Buffer.from(contactHmac, 'base64').length, 32);
});

test('and they are never the same key twice', () => {
  const a = generateSecrets();
  const b = generateSecrets();
  assert.notEqual(a.tierB, a.contactHmac, 'the two keys in one install must differ');
  assert.notEqual(a.tierB, b.tierB, 'two installs must not share a key');
  assert.notEqual(a.contactHmac, b.contactHmac);
});

test('the script asks for neither of them', () => {
  // The check that matters. A future edit that adds a friendly "paste your
  // existing key" prompt would defeat the whole point of generating them.
  const src = fs.readFileSync(new URL('../scripts/configure.js', import.meta.url), 'utf8');
  for (const name of ['TIER_B_ENCRYPTION_KEY', 'CONTACT_HMAC_KEY']) {
    assert.doesNotMatch(src, new RegExp(`ask[A-Za-z]*\\([^)]*${name}`),
      `configure.js prompts for ${name}; it must only ever generate it`);
  }
});

/* ------------------------------------------------------------------ */
group('The installer refuses configurations that would not work');

test('a site origin must be an origin, not a page', () => {
  assert.equal(validateSiteOrigin('https://x.example.org/reports').ok, false);
  assert.equal(validateSiteOrigin('reports.example.org').ok, false);
  assert.equal(validateSiteOrigin('').ok, false);
});

test('a trailing slash is corrected rather than rejected', () => {
  // src/siteOrigin.js builds every link by concatenation, so a trailing
  // slash produces addresses that are subtly wrong rather than broken.
  assert.equal(validateSiteOrigin('https://x.example.org/').value, 'https://x.example.org');
});

test('plain http is refused anywhere but localhost', () => {
  // The curtain password and every one-time code would otherwise cross the
  // network in the clear.
  assert.equal(validateSiteOrigin('http://reports.example.org').ok, false);
  assert.equal(validateSiteOrigin('http://localhost:3000').ok, true);
});

test('a connection string with no database name is refused', () => {
  // It would connect to the role's default database and migrate that.
  assert.equal(validateDatabaseUrl('postgres://u@h:5432/').ok, false);
  assert.equal(validateDatabaseUrl('mysql://u@h/db').ok, false);
});

test('and the socket form is accepted, because a local install uses it', () => {
  // A valid connection string and an invalid URL at the same time, which is
  // why this validator does not use `new URL`.
  const r = validateDatabaseUrl('postgres://u@/reportlog?host=/var/run/postgresql');
  assert.equal(r.ok, true);
  assert.equal(r.database, 'reportlog');
});

/* ------------------------------------------------------------------ */
group('The rendered .env says what it is');

const renderedEnv = renderEnv({
  siteOrigin: 'https://x.example.org',
  databaseUrl: 'postgres://u@h/db',
  tierB: 'AAAA', contactHmac: 'BBBB',
});

test('it writes every variable the app reads', () => {
  for (const key of ['DATABASE_URL', 'SITE_ORIGIN', 'PORT',
    'TIER_B_ENCRYPTION_KEY', 'CONTACT_HMAC_KEY',
    'SCALEWAY_SECRET_KEY', 'SCALEWAY_PROJECT_ID', 'ALERT_FROM_EMAIL',
    'S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY',
    'S3_BUCKET_STAGING', 'S3_BUCKET_EVIDENCE', 'S3_BUCKET_RENDITIONS',
    'ATTACHMENTS_ENABLED', 'TSA_URL']) {
    assert.match(renderedEnv, new RegExp(`^${key}=`, 'm'), `${key} is missing from .env`);
  }
});

test('an unanswered optional value is written empty, not omitted', () => {
  // The file is also the list of what could be set, which a reader needs
  // more than a short file.
  assert.match(renderedEnv, /^SCALEWAY_SECRET_KEY=$/m);
  assert.match(renderedEnv, /^S3_ENDPOINT=$/m);
});

test('the S3 region is read off the endpoint, never defaulted to another provider\'s', () => {
  // The prompt once defaulted to eu-central-1, AWS's name, on a guide that
  // walks through Hetzner — whose regions are fsn1, nbg1 and hel1.
  assert.equal(regionFromEndpoint('https://fsn1.your-objectstorage.com'), 'fsn1');
  assert.equal(regionFromEndpoint('https://hel1.your-objectstorage.com/'), 'hel1');
  assert.equal(regionFromEndpoint('https://s3.eu-west-3.amazonaws.com'), 'eu-west-3');
  assert.equal(regionFromEndpoint('https://s3.nl-ams.scw.cloud'), 'nl-ams');
  assert.equal(regionFromEndpoint('https://minio.example.org'), '', 'no guess beats a wrong one');
  assert.equal(regionFromEndpoint('not a url'), '');
  assert.match(renderedEnv, /^S3_REGION=$/m, 'an unanswered region is written empty');
  const configure = fs.readFileSync(new URL('./configure.js', import.meta.url), 'utf8');
  assert.doesNotMatch(configure, /eu-central-1/);
});

test('the transparency log goes beside the checkout, where the anchor unit may write', () => {
  // The code's own default is a folder in the service user's home — which
  // for the reportlog user is the checkout. The anchor unit allows
  // /srv/reportlog-transparency-log, and install-units.sh substitutes
  // /srv/reportlog the same way, so the two agree for any --dir.
  assert.equal(defaultTransparencyLogDir('/srv/reportlog'), '/srv/reportlog-transparency-log');
  assert.equal(defaultTransparencyLogDir('/opt/rl/'), '/opt/rl-transparency-log');
  assert.match(renderEnv({ transparencyLogDir: '/srv/reportlog-transparency-log' }),
    /^TRANSPARENCY_LOG_DIR=\/srv\/reportlog-transparency-log$/m);
  const unit = fs.readFileSync(new URL('../contrib/systemd/reportlog-anchor.service', import.meta.url), 'utf8');
  assert.match(unit, /^ReadWritePaths=.*\s\/srv\/reportlog-transparency-log\b/m);
});

test('configure asks for the staff address, and attachments start off', () => {
  const configure = fs.readFileSync(new URL('./configure.js', import.meta.url), 'utf8');
  assert.match(configure, /v\.adminEmail = await/);
  assert.match(renderEnv({ adminEmail: 'staff@example.org' }), /^ADMIN_EMAIL=staff@example\.org$/m);
  // Off until storage-smoke has proved the buckets.
  assert.match(configure, /Accept attachments from the start\?', \{ fallback: false \}/);
});

test('ADMIN_EMAIL is written empty, and is only an address', () => {
  // Left for the operator to fill in: it is where volunteer applications
  // and the feedback digest go. It grants nothing.
  assert.match(renderedEnv, /^ADMIN_EMAIL=$/m);
  const cfg = fs.readFileSync(new URL('../src/installConfig.js', import.meta.url), 'utf8');
  assert.ok(!/promotes whoever signs in/.test(cfg),
    'installConfig still describes a promotion that no longer happens');
});

test('signing in never sets a role', () => {
  // THE ONE THAT HAS TO HOLD. ADMIN_EMAIL used to make its holder an
  // administrator on EVERY sign-in — so it reversed later demotions, and it
  // wrote no role_audit row, against the rule src/roles.js exists to
  // enforce. Appointing an administrator is the owner's alone now, and a
  // second quieter way in would hollow that out.
  //
  // Asserted against the source because the alternative is a live database
  // and an email round-trip to prove a negative. COMMENTS ARE STRIPPED
  // FIRST: the explanation of why this was removed necessarily names the
  // thing it removed, and a check that forbids describing its own subject
  // is a check nobody can write around honestly.
  const auth = stripComments(
    fs.readFileSync(new URL('../src/routes/auth.js', import.meta.url), 'utf8'));
  assert.ok(!/ADMIN_EMAIL/.test(auth), 'auth.js reads ADMIN_EMAIL again');
  assert.ok(!/SET role/i.test(auth), 'auth.js writes a role again');
  assert.ok(!/'admin'/.test(auth), 'auth.js names the admin role again');
});

test('every example reference on a page uses the real prefix', () => {
  // The pages told people their report id looked like "EL-XXXXXX-XXXXXX",
  // and offered "EL-…" as the placeholder in the verify box, while the
  // software has been generating RL- references. Somebody checking a report
  // was being shown a format that no report has ever had — a live bug, not
  // a cosmetic one, and left over from a rename.
  //
  // Matches things shaped like an example reference: a short uppercase
  // prefix followed by a placeholder run or a year.
  const shaped = /\b([A-Z]{2,4})-(?:X{4,}|\u2026|\.\.\.|\d{4}-)/g;
  for (const f of ['index.html', 'app.html', 'api.html']) {
    const src = fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(shaped)) {
      assert.equal(`${m[1]}-`, REF_PREFIX,
        `${f} shows "${m[0]}" but references are ${REF_PREFIX}`);
    }
  }
});

test('.env.example documents every key the installer writes', () => {
  // CONTRIBUTING tells a contributor to copy this file and fill it in, so a
  // key the installer generates but this file never mentions is a key
  // nobody following the documented path learns exists. SITE_NAME was
  // exactly that. The reverse is fine and deliberate: this file also
  // documents optional tuning the installer does not ask about.
  const example = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const documented = new Set([...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
  const cfg = fs.readFileSync(new URL('../src/installConfig.js', import.meta.url), 'utf8');
  const generated = new Set([
    ...[...cfg.matchAll(/line\('([A-Z0-9_]+)'/g)].map((m) => m[1]),
    ...[...cfg.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]),
  ]);
  const missing = [...generated].filter((k) => !documented.has(k));
  assert.deepEqual(missing, [], `.env.example is missing: ${missing.join(', ')}`);
});

test('no test restates the palette or theme catalogue', () => {
  // TWICE NOW. site.test.js had both lists typed into it, so the two themes
  // added in b44278c were swept by nothing until it was fixed; branding.js
  // had the palettes typed into it and was missed by that same fix. A
  // restated catalogue does not fail when it falls behind — it goes on
  // passing while covering less than it claims, which is worse than a red
  // check.
  const dir = new URL('../tools/browser-tests/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = stripComments(fs.readFileSync(new URL(f, dir), 'utf8'));
    assert.ok(!/'electionlog'\s*,\s*'paper'/.test(src),
      `${f} restates the palette list — import PALETTE_IDS from src/look.js`);
    assert.ok(!/'signal'\s*,\s*'plain'/.test(src),
      `${f} restates the theme list — import THEME_IDS from src/look.js`);
  }
});

test('no route writes users.role around setSystemRole', () => {
  // roles.js opens by saying the audit row and the change must be
  // impossible to separate. Two moderator routes in admin.js were the
  // counter-example for months, writing raw SQL with no trail, and they
  // were dead code besides. Nothing may reintroduce the pattern.
  const dir = new URL('../src/routes/', import.meta.url);
  const allowed = new Set(['setup.js']); // mints the first owner, inside a lock
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    if (allowed.has(f)) continue;
    const src = stripComments(fs.readFileSync(new URL(f, dir), 'utf8'));
    assert.ok(!/UPDATE users SET role|SET role = EXCLUDED\.role|SET role = '/.test(src),
      `${f} writes users.role directly — go through setSystemRole`);
  }
});

test('readiness reports a half-filled section as off, not as on', () => {
  // Partial is the worst state: it looks configured in the file and behaves
  // exactly as unset.
  const half = readiness({ SMTP_HOST: 'mail.example.org', ALERT_FROM_EMAIL: '' });
  assert.equal(half.email, false);
  assert.equal(half.emailPartial, true);
  assert.deepEqual(half.emailMissing, ['ALERT_FROM_EMAIL']);
});

test('and half a Scaleway configuration is nothing, not something partial', () => {
  // A secret key without a project id selects no transport at all, so the
  // honest report is "no mail configured" rather than "partly configured"
  // — those are different sentences and lead to different fixes.
  const half = readiness({ SCALEWAY_SECRET_KEY: 'x', SCALEWAY_PROJECT_ID: '' });
  assert.equal(half.email, false);
  assert.equal(half.emailTransport, 'log');
  assert.equal(half.emailPartial, false);
});

test('and reports a complete one as on', () => {
  const full = readiness({
    DATABASE_URL: 'x', SITE_ORIGIN: 'x',
    TIER_B_ENCRYPTION_KEY: 'x', CONTACT_HMAC_KEY: 'x',
    SCALEWAY_SECRET_KEY: 'x', SCALEWAY_PROJECT_ID: 'x', ALERT_FROM_EMAIL: 'x',
  });
  assert.equal(full.bootable, true);
  assert.equal(full.secrets, true);
  assert.equal(full.email, true);
  assert.equal(full.emailPartial, false);
});

/* ------------------------------------------------------------------ */
group('Mail works with more than one provider');

// This file used to talk only to Scaleway's HTTP API, which meant the
// software could only be installed by somebody with a Scaleway account —
// and mail is not optional: without it no report can be confirmed, and the
// one-time sign-in code reaches only the service log.

test('SMTP is chosen as soon as a host is set', () => {
  assert.equal(transportFor({ SMTP_HOST: 'mail.example.org' }), 'smtp');
});

test('Scaleway still works, and needs both of its values', () => {
  assert.equal(transportFor({ SCALEWAY_SECRET_KEY: 'k', SCALEWAY_PROJECT_ID: 'p' }), 'scaleway');
  // One without the other is not a configuration, and inferring scaleway
  // from half of it would send every message at a 401.
  assert.equal(transportFor({ SCALEWAY_SECRET_KEY: 'k' }), 'log');
  assert.equal(transportFor({ SCALEWAY_PROJECT_ID: 'p' }), 'log');
});

test('nothing configured means nothing is sent', () => {
  assert.equal(transportFor({}), 'log');
});

test('and an operator can force the choice, including forcing silence', () => {
  // A staging box that must never send real mail is a real requirement,
  // and "unset the credentials" is a worse way to express it.
  assert.equal(transportFor({ EMAIL_TRANSPORT: 'log', SMTP_HOST: 'h' }), 'log');
  assert.equal(transportFor({ EMAIL_TRANSPORT: 'smtp', SCALEWAY_SECRET_KEY: 'k', SCALEWAY_PROJECT_ID: 'p' }), 'smtp');
  // An unrecognised value is ignored rather than obeyed — a typo in
  // EMAIL_TRANSPORT must not silently disable mail.
  assert.equal(transportFor({ EMAIL_TRANSPORT: 'sendmail', SMTP_HOST: 'h' }), 'smtp');
});

test('a half-configured transport is reported as unable, not as ready', () => {
  // It looks set in the file and fails at the first send.
  assert.equal(readinessFor({ SMTP_HOST: 'h' }).ok, false);
  assert.deepEqual(readinessFor({ SMTP_HOST: 'h' }).missing, ['ALERT_FROM_EMAIL']);
});

test('an SMTP username without a password is incomplete', () => {
  const r = readinessFor({ SMTP_HOST: 'h', SMTP_USER: 'u', ALERT_FROM_EMAIL: 'a@b.co' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['SMTP_PASS']);
});

test('but no username at all is a deliberate unauthenticated relay', () => {
  // A Postfix on localhost taking submission without auth is a normal
  // arrangement and must not be reported as broken.
  assert.equal(readinessFor({ SMTP_HOST: 'localhost', ALERT_FROM_EMAIL: 'a@b.co' }).ok, true);
});

test('the installer and the app agree on all of that', () => {
  // readiness() in installConfig.js delegates rather than reimplementing.
  // Two answers to "can this deployment send mail" is how an installer
  // reports ready for something that then cannot send.
  for (const env of [
    {}, { SMTP_HOST: 'h' }, { SMTP_HOST: 'h', ALERT_FROM_EMAIL: 'a@b.co' },
    { SCALEWAY_SECRET_KEY: 'k', SCALEWAY_PROJECT_ID: 'p', ALERT_FROM_EMAIL: 'a@b.co' },
  ]) {
    assert.equal(readiness(env).email, readinessFor(env).ok, JSON.stringify(env));
    assert.equal(readiness(env).emailTransport, transportFor(env), JSON.stringify(env));
  }
});

test('the rendered .env carries both transports and the switch', () => {
  const out = renderEnv({ siteOrigin: 'https://x.example.org', databaseUrl: 'postgres://u@h/db' });
  for (const key of ['EMAIL_TRANSPORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER',
    'SMTP_PASS', 'SMTP_SECURE', 'SCALEWAY_SECRET_KEY', 'SCALEWAY_PROJECT_ID']) {
    assert.match(out, new RegExp(`^${key}=`, 'm'), `${key} missing from .env`);
  }
});

test('the "cannot send" reason six callers depend on is unchanged', () => {
  // src/routes/auth.js, setup.js, orgs.js and volunteer.js all test
  // `reason === 'no-api-key'` to decide whether to log a sign-in code that
  // could not be emailed. Renaming it would silently strand the operator
  // of a deployment whose mail is not configured yet.
  const src = fs.readFileSync(new URL('../src/email.js', import.meta.url), 'utf8');
  assert.match(src, /reason: 'no-api-key'/);
});

/* ------------------------------------------------------------------ */
group('A deployment can carry its own name');

// The name was the string 'ReportLog' in about twenty places. Fine for the
// deployment that wrote it; wrong for anybody installing it on their own
// server, who got a site named after the software with no way to say whose
// it was.

test('an administrator\u2019s choice wins', () => {
  assert.equal(resolveSiteName({ site_name: 'Wahlbeobachtung Berlin' }, { SITE_NAME: 'From Env' }),
    'Wahlbeobachtung Berlin');
});

test('then what the installer seeded', () => {
  assert.equal(resolveSiteName({ site_name: null }, { SITE_NAME: 'From Env' }), 'From Env');
  assert.equal(resolveSiteName(null, { SITE_NAME: 'From Env' }), 'From Env');
});

test('and failing both, the software\u2019s own name', () => {
  assert.equal(resolveSiteName(null, {}), SOFTWARE_NAME);
  assert.equal(resolveSiteName({ site_name: null }, {}), SOFTWARE_NAME);
});

test('whitespace is not a name', () => {
  // Otherwise a stray space in the admin field blanks every page header.
  assert.equal(resolveSiteName({ site_name: '   ' }, { SITE_NAME: 'From Env' }), 'From Env');
  assert.equal(resolveSiteName({ site_name: '' }, {}), SOFTWARE_NAME);
});

test('a name has to fit a page header and a mail subject', () => {
  assert.equal(validateSiteName('').ok, false);
  assert.equal(validateSiteName('x'.repeat(MAX_SITE_NAME + 1)).ok, false);
  assert.equal(validateSiteName('  Trimmed  ').value, 'Trimmed');
});

/* ------------------------------------------------------------------ */
group('The name is presentation, never part of the record');

test('migration 012 touches only site_settings and is additive', () => {
  const sql = fs.readFileSync(new URL('../migrations/012_site_name.sql', import.meta.url), 'utf8');
  const altered = [...sql.matchAll(/ALTER TABLE (\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(altered)], ['site_settings']);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN/i);
});

test('and no sealed field builder can see it', () => {
  // A report must not verify differently because somebody renamed the site.
  for (const f of ['reportCore.js', 'verify.js']) {
    const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /site_name|siteName/, `${f} reads the site name`);
  }
});

/* ------------------------------------------------------------------ */
group('Attribution survives renaming');

test('the footer credits the software whatever the site is called', () => {
  // A deployment naming itself is not a deployment claiming to have written
  // this, and AGPL attribution belongs where a reader can see it.
  assert.match(indexHtml, /Powered by <a[^>]*>ReportLog<\/a>/);
});

test('and that line is static markup, not something a rename can reach', () => {
  // If it were a data-brand element it would be renamed along with
  // everything else, which is the one thing it must not do.
  const poweredBy = indexHtml.match(/<div class="poweredby"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(poweredBy, 'the attribution line is missing');
  assert.doesNotMatch(poweredBy[0], /data-brand/);
});

test('every brand surface is marked rather than left as a literal', () => {
  // The page headers all had 'ReportLog' written into them. A leftover
  // literal is a header that keeps the software's name on a renamed site.
  const eyebrows = [...indexHtml.matchAll(/<p class="eyebrow"([^>]*)>([^<]*)</g)];
  const unmarked = eyebrows.filter((m) => /ReportLog/.test(m[2]) && !/data-brand/.test(m[1]));
  assert.deepEqual(unmarked.map((m) => m[2]), [],
    'these page headers would keep saying ReportLog on a renamed deployment');
});

test('nothing builds a branded label at parse time any more', () => {
  // ABTOC_EXTRA did exactly this: a top-level array concatenating
  // SITE_TITLE before the server had answered, so it kept the default
  // forever. Templates go through brand() at render instead.
  assert.doesNotMatch(pageJs, /^var [A-Z_]+ = \[[\s\S]{0,400}'[^']*'\s*\+\s*SITE_TITLE/m,
    'a top-level array captures SITE_TITLE before applyBrand has run');
});

/* ------------------------------------------------------------------ */
group('No shipped page says ReportLog where it means the deployment');

/**
 * The audit this group exists to keep. Every literal "ReportLog" in a page
 * a visitor is served has to be one of three things:
 *
 *   - inside an element that gets PAINTED with the deployment's name
 *     (`data-brand`, `data-brand-phrase`, `data-brand-title`),
 *   - inside prose where the software is speaking ABOUT ITSELF and the word
 *     is correct (`data-software-text`),
 *   - or a named exception below, each with the mechanism that handles it.
 *
 * WHY A POSITIVE MARKER RATHER THAN A BIGGER ALLOWLIST. About is about to
 * gain a long section in which "ReportLog" is the right word in twenty
 * places. Absorbing those as exceptions would widen this until it caught
 * nothing, and a check that has been quietly muted is worse than no check
 * at all — it reads as coverage. Marking the prose keeps the check sharp.
 */

// The two named exceptions. Both are the software's name standing in as a
// DEFAULT that something rewrites at runtime, and neither can carry a brand
// attribute: `<title>` cannot hold the accent spans applyBrand paints, and a
// crawler reads the file exactly as it sits on disk. The test below asserts
// the two mechanisms that cover them, so an exception cannot outlive its fix.
//
// Listed as exact strings and deleted before the walk, so this is a short
// enumerated list rather than a hole in the matcher that anything could
// fall through.
const NAMED_EXCEPTIONS = [
  '<title>ReportLog</title>',
  '<meta name="apple-mobile-web-app-title" content="ReportLog">',
];

// Anything that is not rendered text: comments, scripts and stylesheets.
// A `var SOFTWARE_NAME='ReportLog'` is the software naming itself in its own
// source and is not a branding surface.
function renderedMarkup(html) {
  return NAMED_EXCEPTIONS.reduce((acc, ex) => acc.split(ex).join(''), html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
}

const MARKERS = /\b(data-brand|data-brand-phrase|data-brand-title|data-software-text)\b/;
const VOID_TAGS = new Set(['meta', 'link', 'img', 'input', 'br', 'hr', 'source', 'track', 'area', 'base', 'col', 'embed', 'param', 'wbr']);

/**
 * Walk the markup keeping a stack of open elements, and report every run of
 * text containing "ReportLog" that has no marked ancestor. Attribute values
 * are checked on the tag itself.
 */
function unmarkedBrandLiterals(html) {
  const found = [];
  /** Open elements, innermost last: { tag, attrs }. */
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let last = 0;
  let m;
  const marked = () => stack.some((e) => MARKERS.test(e.attrs));

  const text = (s, end) => {
    const run = s.slice(last, end);
    if (run.includes('ReportLog') && !marked()) {
      found.push(run.replace(/\s+/g, ' ').trim().slice(0, 90));
    }
  };

  while ((m = tagRe.exec(html)) !== null) {
    text(html, m.index);
    const [, closing, rawName, attrs] = m;
    const name = rawName.toLowerCase();
    if (closing) {
      // Unwind to the matching open tag; malformed nesting must not desync
      // the stack and turn this check into a random-number generator.
      const at = stack.map((e) => e.tag).lastIndexOf(name);
      if (at !== -1) stack.length = at;
    } else {
      // A `placeholder` shows the default in an empty box and is meant to
      // say ReportLog: the field is asking whether to override it.
      const attrsWithoutPlaceholder = attrs.replace(/placeholder\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
      if (attrsWithoutPlaceholder.includes('ReportLog') && !MARKERS.test(attrs) && !marked()) {
        found.push(`<${name} ${attrsWithoutPlaceholder.replace(/\s+/g, ' ').trim().slice(0, 90)}>`);
      }
      if (!VOID_TAGS.has(name) && !m[0].endsWith('/>')) stack.push({ tag: name, attrs });
    }
    last = tagRe.lastIndex;
  }
  text(html, html.length);
  return found;
}

const SHIPPED_PAGES = ['index.html', 'app.html', 'api.html'];

for (const page of SHIPPED_PAGES) {
  test(`${page} names the deployment everywhere it speaks for it`, () => {
    const html = fs.readFileSync(new URL(`../public/${page}`, import.meta.url), 'utf8');
    assert.deepEqual(unmarkedBrandLiterals(renderedMarkup(html)), [],
      `these would keep saying ReportLog on a renamed deployment — mark them `
      + `data-brand if they are the name, or data-software-text if the software `
      + `is genuinely speaking about itself`);
  });
}

test('the check can actually fail', () => {
  // A grep that matches nothing looks exactly like a grep that passes. This
  // is the assertion that tells the two apart, and it is why the walker is
  // exercised on a string rather than only on the real file.
  assert.deepEqual(unmarkedBrandLiterals('<p>Welcome to ReportLog</p>'), ['Welcome to ReportLog']);
  assert.deepEqual(unmarkedBrandLiterals('<p data-brand>ReportLog</p>'), []);
  assert.deepEqual(unmarkedBrandLiterals('<div data-software-text><p>ReportLog is AGPL</p></div>'), []);
  assert.deepEqual(unmarkedBrandLiterals('<input placeholder="ReportLog">'), []);
  assert.deepEqual(unmarkedBrandLiterals('<meta content="ReportLog">'), ['<meta content="ReportLog">']);
  // A closed marked element must not go on covering what follows it.
  assert.deepEqual(unmarkedBrandLiterals('<p data-brand>ReportLog</p><p>ReportLog</p>'), ['ReportLog']);
});

test('the static title and its iOS twin are rewritten by name', () => {
  // These two are the named exception: `<title>` cannot carry accent runs
  // and a crawler reads the file as it sits on disk, so the literal stays
  // and both the server and the page rewrite it. This asserts the mechanism
  // the exception depends on, so the exception cannot outlive it.
  const src = fs.readFileSync(new URL('../src/indexPage.js', import.meta.url), 'utf8');
  assert.match(src, /<title>\$\{SOFTWARE_NAME\}<\/title>/);
  assert.match(src, /apple-mobile-web-app-title/);
  // Both exceptions must still BE in the file. An exception that no longer
  // matches anything is a dead entry that quietly widens the allowlist.
  for (const ex of NAMED_EXCEPTIONS) {
    assert.ok(indexHtml.includes(ex),
      `the named exception ${ex} is not in index.html — indexPage.js substitutes `
      + 'these exact strings, so a change here silently stops a rename reaching the tab');
  }
  assert.match(pageJs, /if\(!document\.title\|\|document\.title===SOFTWARE_NAME\) document\.title=name;/,
    'the client-side title rewrite is what covers the nginx-served case');
});

test('the manifest is built per deployment, not served from disk', () => {
  // The one branding surface no client-side painting can reach: the browser
  // reads the manifest itself, so an installed home-screen icon carries
  // whatever this says forever.
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const manifestRoute = server.indexOf("app.get('/manifest.webmanifest'");
  const staticMount = server.indexOf('app.use(express.static');
  assert.ok(manifestRoute !== -1, 'no dynamic manifest route');
  assert.ok(manifestRoute < staticMount,
    'the manifest route must come before express.static or the file on disk wins');
  const conf = fs.readFileSync(new URL('../contrib/nginx/reportlog.conf', import.meta.url), 'utf8');
  assert.match(conf, /location = \/manifest\.webmanifest/,
    'nginx serves public/ itself, so it has to be told to send this path to the app');
});

test('every palette states the two colours the manifest needs', () => {
  // Parsed from the stylesheet rather than restated, so this is really a
  // check that the parse still finds them all — a renamed token or a
  // reformatted block would otherwise silently drop a palette to the default.
  const colors = paletteColors();
  assert.deepEqual([...colors.keys()].sort(), [...PALETTE_IDS].sort(),
    'a palette the manifest cannot colour falls back to the default one');
  for (const [id, c] of colors) {
    assert.match(c.background, /^#[0-9A-Fa-f]{6}$/, `${id} background`);
    assert.match(c.deep, /^#[0-9A-Fa-f]{6}$/, `${id} deep`);
  }
});

/* ------------------------------------------------------------------ */
group('The team-member flag is a flag, and desks are display only');

test('the desk ids are the ones people already have stored', () => {
  // They were derived from the volunteer form's role ids until that form
  // became a list. Desks are stored against people, so the ids must not
  // move when their source does — a changed id silently drops a desk.
  assert.deepEqual(DESK_IDS, ['lead_dev', 'dev', 'accessibility', 'moderating', 'testing',
    'group', 'policy', 'translation', 'design', 'outreach']);
  for (const id of DESK_IDS) assert.ok(!SYSTEM_ROLES.includes(id), `${id} must not be a system role`);
});

test('and the ways of starting a conversation are not jobs', () => {
  // "Something else" and "Just saying hello" are in the `ask` group. They
  // are how somebody makes contact, not a desk anybody sits at.
  assert.ok(!DESK_IDS.includes('other'));
  assert.ok(!DESK_IDS.includes('hello'));
  assert.ok(DESK_IDS.includes('moderating') && DESK_IDS.includes('outreach'));
});

test('every desk lands somewhere that exists', () => {
  // A desk whose landing tab was renamed would silently drop that person on
  // the default, which reads as the feature not working rather than as a bug.
  for (const d of DESKS) {
    assert.ok(PORTAL_TAB_IDS.includes(d.opensOn), `${d.id} opens on ${d.opensOn}, which is not a tab`);
  }
});

test('a desk grants nothing, so an unknown one is dropped and not refused', () => {
  assert.deepEqual(normalizeDesks(['design', 'nonsense', 'design', '', null]), ['design']);
  assert.deepEqual(normalizeDesks('design'), []);
  assert.deepEqual(normalizeDesks(undefined), []);
});

test('somebody with several desks lands on the first, and with none on Start here', () => {
  assert.equal(openingTab([]), 'start');
  assert.equal(openingTab(['nonsense']), 'start');
  assert.equal(openingTab(['outreach']), 'comms');
  // DESKS order decides, not the order they were given, so the answer is
  // stable rather than depending on how somebody's row happens to be sorted.
  assert.equal(openingTab(['outreach', 'moderating']), openingTab(['moderating', 'outreach']));
});

test('THE FLAG IS NOT A ROLE — the ceiling gains no new way to be wrong', () => {
  // The whole reason this is a flag. Every grantable role is another path
  // through canGrantSystemRole, which is asserted, tested, and checked
  // again at the route.
  assert.ok(!SYSTEM_ROLES.includes('team_member'), 'team member became a system role');
  const src = fs.readFileSync(new URL('../src/roles.js', import.meta.url), 'utf8');
  assert.match(src, /export async function setTeamMemberFlag/);
  // Modelled on the tester flag: same audit axis, so one query answers
  // "what was granted to whom" for both.
  const fn = src.slice(src.indexOf('export async function setTeamMemberFlag'));
  assert.match(fn.slice(0, 2000), /axis: 'flag'/);
});

test('and revoking it takes the desks with it', () => {
  // Otherwise somebody removed from the team keeps a job title in the audit
  // log and on the roster.
  const src = fs.readFileSync(new URL('../src/roles.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function setTeamMemberFlag'));
  assert.match(fn.slice(0, 1200), /on \? normalizeDesks\(desks\) : \[\]/);
});

test('migration 022 is additive, and touches only users', () => {
  const sql = fs.readFileSync(new URL('../migrations/022_team_member.sql', import.meta.url), 'utf8');
  const altered = [...sql.matchAll(/ALTER TABLE (\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(altered)], ['users']);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN/i);
  assert.match(sql, /ADD COLUMN is_team_member boolean NOT NULL DEFAULT false/);
});

test('nothing in the chain can see the flag or the desks', () => {
  // Same rule as the site name: a report must not verify differently
  // because somebody joined the team.
  for (const f of ['reportCore.js', 'verify.js']) {
    const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /is_team_member|isTeamMember|desks/, `${f} reads the team flag`);
  }
});

/* ------------------------------------------------------------------ */
group('The documented commands are the commands that work');

test('npm run test:db loads the environment it needs', () => {
  // It did not, and exited with "Set DATABASE_URL" on a correctly
  // configured box — a failure that reads like a database problem and is
  // not. Every other entry point either imports src/db.js, which loads
  // dotenv, or is started with --env-file; this one talks to pg directly.
  // The line in CLAUDE.md and in the standing orders has to be the line
  // that runs, or the third suite quietly stops being run at all.
  const src = fs.readFileSync(new URL('../scripts/db-selftest.js', import.meta.url), 'utf8');
  assert.match(src, /^import 'dotenv\/config';/m,
    'npm run test:db cannot read DATABASE_URL from .env');
});

/* ------------------------------------------------------------------ */
group('The panel owns its spacing, and no element carries its own');

test('no shipped page sets a margin inline', () => {
  // Thirty-odd inline margins — 10px, 14px, 15px, 16px, 18px, 22px — each
  // picked one at a time by whoever was in the file. "Save" sat hard
  // against the field above it in one panel and against an error line in
  // another, and every new panel copied whichever neighbour it was pasted
  // next to. Spacing belongs to the panel; a class says which role an
  // element plays and the stylesheet decides the gap.
  //
  // This is a GREP AND NOT A PARAGRAPH for the same reason the lockfile
  // rule is: prose telling somebody not to do this does not survive a busy
  // afternoon, and the failure is invisible until somebody looks at two
  // panels side by side.
  for (const page of SHIPPED_PAGES) {
    const html = fs.readFileSync(new URL(`../public/${page}`, import.meta.url), 'utf8');
    const offenders = [...html.matchAll(/style="[^"]*\bmargin[^"]*"/g)].map((m) => m[0]);
    assert.deepEqual(offenders, [],
      `${page}: use a class — .grouped, .form_label-sep, .formstatus or .actions — not an inline margin`);
  }
});

test('and the four roles it replaced all have a rule', () => {
  /* A class named in the markup with no rule behind it is spacing that
     silently does nothing, which is worse than the inline margin was.

     THIS TEST WAS ITSELF THE DEMONSTRATION. It asked for `.lab-sep`, and
     `.lab-sep` had a rule — in page.css, matching `.form_label.lab-sep`,
     which nothing in the application has ever worn. The markup says
     `form_label-sep`. So the check passed for years on a rule that styled
     nothing and a class that was styled by nothing, each covering for the
     other. It names the class the markup actually carries now, and reads
     both stylesheets, because the rule lives beside the form vocabulary in
     client-first.css. */
  const everyRule = `${cfCss}\n${pageCss}`;
  for (const cls of ['.grouped', '.form_label-sep', '.formstatus', '.actions']) {
    assert.ok(everyRule.includes(`${cls}{`), `${cls} is used but has no rule`);
  }
});

test('every button in a panel gets the same gap above it, whichever kind', () => {
  // The button flavours each carried their own spacing or none at all. This is
  // the shared rule they never had; they are all `.button` now.
  assert.match(pageCss, /\.panel_component > \.button,\s*\n\.panel_component > \.actions\{margin-top:16px\}/);
});

/* ------------------------------------------------------------------ */
group('The doctor knows what to tell each kind of machine');

// Somebody installing this already has a server; what they lack is the list
// of what is missing and the command that fixes it. A README cannot give
// them that, because it does not know their distribution — and four of the
// six binaries come from a package with a different name.

const osrel = (id, like) => `ID=${id}\n${like ? `ID_LIKE="${like}"\n` : ''}`;

test('it recognises the families from os-release', () => {
  assert.equal(detectFamily({ osRelease: osrel('ubuntu', 'debian'), platform: 'linux' }), 'apt');
  assert.equal(detectFamily({ osRelease: osrel('debian'), platform: 'linux' }), 'apt');
  assert.equal(detectFamily({ osRelease: osrel('fedora'), platform: 'linux' }), 'dnf');
  assert.equal(detectFamily({ osRelease: osrel('rocky', 'rhel centos fedora'), platform: 'linux' }), 'dnf');
  assert.equal(detectFamily({ osRelease: osrel('arch'), platform: 'linux' }), 'pacman');
  assert.equal(detectFamily({ osRelease: osrel('alpine'), platform: 'linux' }), 'apk');
});

test('macOS is decided by platform, not by a file it does not have', () => {
  assert.equal(detectFamily({ osRelease: '', platform: 'darwin' }), 'brew');
});

test('an unknown distribution falls back to what is actually installed', () => {
  // A container can carry an ID nothing recognises and still obviously be
  // apt-based.
  assert.equal(detectFamily({
    osRelease: osrel('somethingnew'), platform: 'linux', have: (b) => b === 'apt-get',
  }), 'apt');
});

test('and if nothing is recognised it says so rather than guessing', () => {
  // A wrong install command is worse than none, because somebody runs it.
  assert.equal(detectFamily({ osRelease: osrel('mystery'), platform: 'linux' }), null);
  assert.equal(installCommand(['ffmpeg'], null), null);
});

test('package names are right for each family, not guessed from the binary', () => {
  // The four that do not match the binary name are the whole reason this
  // table is written out.
  assert.equal(TOOL_PACKAGES.ffprobe.apt, 'ffmpeg');
  assert.equal(TOOL_PACKAGES.pdftoppm.apt, 'poppler-utils');
  assert.equal(TOOL_PACKAGES['heif-convert'].apt, 'libheif-examples');
  assert.equal(TOOL_PACKAGES['heif-convert'].dnf, 'libheif-tools');
  assert.equal(TOOL_PACKAGES['heif-convert'].pacman, 'libheif');
});

test('one command installs everything missing, without repeating a package', () => {
  // ffmpeg provides two binaries and poppler provides two, so a naive
  // mapping asks apt for each twice.
  const cmd = installCommand(['ffmpeg', 'ffprobe', 'pdftoppm', 'pdfinfo'], 'apt');
  assert.equal((cmd.match(/ffmpeg/g) || []).length, 1, cmd);
  assert.equal((cmd.match(/poppler-utils/g) || []).length, 1, cmd);
});

test('and it is the right command for the family', () => {
  assert.match(installCommand(['ffmpeg'], 'apt'), /apt install -y ffmpeg/);
  assert.match(installCommand(['ffmpeg'], 'dnf'), /dnf install -y ffmpeg/);
  assert.match(installCommand(['ffmpeg'], 'pacman'), /pacman -S --needed ffmpeg/);
  assert.match(installCommand(['ffmpeg'], 'apk'), /apk add ffmpeg/);
  assert.match(installCommand(['ffmpeg'], 'brew'), /^brew install ffmpeg/);
});

test('the caveats that actually stop an install are printed beside it', () => {
  // Fedora ships no ffmpeg of its own, and a command that cannot work
  // without RPM Fusion should not be handed over silently.
  assert.match(installNotes(['ffmpeg'], 'dnf').join(' '), /RPM Fusion/);
  assert.match(installNotes(['heif-convert'], 'apk').join(' '), /community repository/);
  // And no noise on the families where there is no caveat.
  assert.deepEqual(installNotes(['ffmpeg'], 'apt'), []);
});

test('the database commands name the real role and database', () => {
  // Printing a generic `createdb reportlog` for a deployment whose
  // connection string says otherwise is how somebody creates the wrong
  // database and then wonders why it is still empty.
  const cmds = databaseSetupCommands('postgres://rluser:pw@127.0.0.1:5432/reportlog_prod');
  assert.match(cmds.join('\n'), /createuser rluser/);
  assert.match(cmds.join('\n'), /createdb reportlog_prod -O rluser/);
});

test('including for the socket form, which is not a valid URL', () => {
  const cmds = databaseSetupCommands('postgres://appuser@/mydb?host=/var/run/postgresql');
  assert.match(cmds.join('\n'), /createuser appuser/);
  assert.match(cmds.join('\n'), /createdb mydb/);
});

test('the node version check compares majors, not strings', () => {
  // '9' > '22' lexically, which would pass a machine that cannot run this.
  assert.equal(nodeVersionOk('v22.1.0', '>=22.0.0').ok, true);
  assert.equal(nodeVersionOk('v24.0.0', '>=22.0.0').ok, true);
  assert.equal(nodeVersionOk('v20.11.0', '>=22.0.0').ok, false);
  assert.equal(nodeVersionOk('v9.0.0', '>=22.0.0').ok, false);
});

test('the doctor checks for the scanner only when scanning is switched on', () => {
  // clamdscan had a package mapping and no check, so a box with
  // CLAMAV_ENABLED=true and no scanner held every upload with a clean doctor.
  const doctor = fs.readFileSync(new URL('./doctor.js', import.meta.url), 'utf8');
  assert.match(doctor, /if \(process\.env\.CLAMAV_ENABLED === 'true'\) \{\s+const have = scannerAvailable\(\);/);
  assert.match(installCommand(['clamdscan'], 'apt'), /clamav-daemon/);
});

test('the server refuses an old Node before anything else of ours runs', () => {
  // INSTALL.md says it refuses to start; for a long time nothing did.
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.equal(server.split('\n')[0], "import './src/nodeFloor.js';",
    'the Node check must be the first import, or other modules run on the old Node first');
  const floor = new URL('../src/nodeFloor.js', import.meta.url).pathname;
  const pretend = (v) => `data:text/javascript,Object.defineProperty(process,'version',{value:'${v}'})`;
  let refused = '';
  try {
    execFileSync(process.execPath, ['--import', pretend('v20.11.0'), floor], { stdio: 'pipe' });
  } catch (e) { refused = String(e.stderr); }
  assert.match(refused, /needs Node 22 or newer, and this is Node 20/);
  execFileSync(process.execPath, ['--import', pretend('v22.0.0'), floor], { stdio: 'pipe' });
});

test('the doctor installs nothing', () => {
  // The whole promise of it. A script that apt-installs on somebody's
  // server without being asked is what a developer should distrust from
  // security software, and being right about the package names does not
  // make it less rude.
  const src = fs.readFileSync(new URL('../scripts/doctor.js', import.meta.url), 'utf8');
  for (const bad of [/execFileSync\(\s*['"`]sudo/, /execFileSync\(\s*['"`]apt/,
    /spawnSync\(\s*['"`]sudo/, /\bexecSync\(/]) {
    assert.doesNotMatch(src, bad, 'doctor.js looks like it runs an installer');
  }
  // It may ask whether a binary exists, and it may ASK SYSTEMD A QUESTION.
  //
  // The second was added when the doctor learned to check whether the timers
  // are enabled — a deployment that is not anchoring or not backing up looks
  // completely healthy, and no amount of reading this repository can see it.
  // `list-unit-files` changes nothing, which is the line this guard is really
  // drawing: not "runs no processes" but "changes nothing".
  //
  // So the allowance is narrow and the mutating verbs are named below, where
  // this check is now stricter than it was: before, `systemctl enable` would
  // have been caught only by the shape of the call, and now it is caught by
  // name as well.
  const calls = [...src.matchAll(/execFileSync\(([^)]*)\)/g)].map((m) => m[1]);
  for (const call of calls) {
    const readOnly = /command -v/.test(call)
      || (/['"`]systemctl['"`]/.test(call) && /list-unit-files|list-timers|is-active|is-enabled|show/.test(call));
    assert.ok(readOnly, `unexpected process call: ${call}`);
  }
  for (const verb of ['enable', 'disable', 'start', 'stop', 'restart', 'reload',
    'daemon-reload', 'mask', 'unmask']) {
    assert.doesNotMatch(src, new RegExp(`systemctl['"\`],\\s*\\[?['"\`]?${verb}`),
      `doctor.js looks like it runs systemctl ${verb}`);
  }
});

/* ------------------------------------------------------------------ */
group('The shipped service files match the software');

// contrib/ exists because nothing shipped: the nginx and systemd config
// lived in a private infrastructure repository, so anybody else installing
// this got no reverse proxy and no service unit. Files that ship have to
// keep working, and these reference scripts by path — a renamed script
// leaves a unit that fails at start with nothing saying why.

const contribDir = new URL('../contrib/', import.meta.url);
const unitFiles = fs.readdirSync(new URL('systemd/', contribDir));

test('the app and every scheduled job have a unit', () => {
  for (const name of ['reportlog.service', 'reportlog-media-worker.service',
    'reportlog-media-worker.timer', 'reportlog-anchor.service',
    'reportlog-anchor.timer', 'reportlog-sweep.service', 'reportlog-sweep.timer',
    'reportlog-backup.service', 'reportlog-backup.timer']) {
    assert.ok(unitFiles.includes(name), `contrib/systemd/${name} is missing`);
  }
});

test('every script a unit runs actually exists', () => {
  const missing = [];
  for (const file of unitFiles) {
    const body = fs.readFileSync(new URL(`systemd/${file}`, contribDir), 'utf8');
    for (const m of body.matchAll(/ExecStart=.*?(scripts\/[\w-]+\.js|server\.js)/g)) {
      const rel = m[1];
      if (!fs.existsSync(new URL(`../${rel}`, import.meta.url))) missing.push(`${file} -> ${rel}`);
    }
  }
  assert.deepEqual(missing, [], `units point at scripts that do not exist: ${missing.join(', ')}`);
});

test('each timer has the service it drives', () => {
  // An enabled timer whose service is absent is a unit that fails once a
  // minute into the journal and nowhere else.
  for (const timer of unitFiles.filter((f) => f.endsWith('.timer'))) {
    const service = timer.replace(/\.timer$/, '.service');
    assert.ok(unitFiles.includes(service), `${timer} has no ${service}`);
  }
});

test('the units do not let the app write outside its own checkout', () => {
  // ProtectSystem=strict with ReadWritePaths is what stops a compromised
  // process writing anywhere on the box. It is the one hardening line worth
  // asserting, because it is also the one somebody removes to fix a
  // permission error.
  //
  // ONE UNIT CANNOT BE CONFINED THIS WAY and it is named here rather than
  // skipped: reportlog-update.service restarts a service, installs
  // dependencies and runs migrations, and ProtectSystem=strict stops all
  // three. An exemption that was a silent `continue` would also exempt the
  // next unit somebody wrote. So the list is exact, and an unconfined unit
  // must say in its own text why.
  const MAY_BE_UNCONFINED = ['reportlog-update.service'];

  const unconfined = [];
  for (const file of unitFiles.filter((f) => f.endsWith('.service'))) {
    const body = fs.readFileSync(new URL(`systemd/${file}`, contribDir), 'utf8');
    if (MAY_BE_UNCONFINED.includes(file)) {
      unconfined.push(file);
      assert.match(body, /Deliberately NOT hardened/,
        `${file} is exempt from hardening and does not say why`);
      continue;
    }
    assert.match(body, /ProtectSystem=strict/, `${file} is missing ProtectSystem=strict`);
    assert.match(body, /ReadWritePaths=/, `${file} is missing ReadWritePaths`);
    assert.match(body, /NoNewPrivileges=true/, `${file} is missing NoNewPrivileges`);
  }

  // And the exemption list may not quietly name a unit that no longer exists,
  // which is how an allowlist stops meaning anything.
  assert.deepEqual(unconfined.sort(), [...MAY_BE_UNCONFINED].sort(),
    'the unconfined list names a unit that does not ship');
});

test('the rendered guide never cross-references a step by number', () => {
  // THE PAGE BRANCHES NOW, so "step 7" is a claim that stops being true the
  // moment a reader answers a question. A text-only deployment has no media
  // tools step, every step after it renumbers, and sixteen references that
  // were right for one reader are off by one for the other. There is no way
  // to keep numbers correct for both, so the guide names steps instead.
  //
  // Inserting the media step had already broken most of them before anybody
  // chose anything: they had been written against a twelve-step list.
  const rendered = fs.readFileSync(new URL('../public/docs.html', import.meta.url), 'utf8');
  const text = rendered.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  const hits = [...text.matchAll(/\b[Ss]teps?\s+(\d+)/g)].map((m) => m[0].trim());
  assert.deepEqual(hits, [],
    `docs.html refers to steps by number, which branching makes wrong: ${hits.join(', ')}`);

  // The markdown guide is NOT branched and its §3.x numbering is stable, so
  // this applies to the rendered one only. Said here so nobody "fixes"
  // INSTALL.md to match.
  const guide = fs.readFileSync(new URL('../INSTALL.md', import.meta.url), 'utf8');
  assert.ok(guide.includes('## 3.'), 'INSTALL.md no longer uses numbered sections');
});

test('no guide states a unit count that disagrees with what ships', () => {
  // INSTALL.md said "Five systemd units keep it going" long after there were
  // nine services and eight timers. The timer guard did not catch it because
  // it counts the word "timers" and this sentence says "units".
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const dir = fs.readdirSync(new URL('../contrib/systemd/', import.meta.url));
  const services = dir.filter((f) => f.endsWith('.service')).length;
  const timers = dir.filter((f) => f.endsWith('.timer')).length;

  const guide = fs.readFileSync(new URL('../INSTALL.md', import.meta.url), 'utf8');
  const rendered = fs.readFileSync(new URL('../public/docs.html', import.meta.url), 'utf8');

  for (const [what, raw] of [['INSTALL.md', guide], ['docs.html', rendered]]) {
    const text = raw.replace(/<[^>]+>/g, ' ').replace(/[*>&;]/g, ' ').replace(/\s+/g, ' ');
    for (const [, word] of text.matchAll(/\b([a-z]+) systemd units\b/gi)) {
      const n = WORDS[word.toLowerCase()];
      if (n === undefined) continue;  // "the systemd units", "these systemd units"
      assert.ok(n === services || n === services + timers,
        `${what} says "${word} systemd units" and ${services} services `
        + `plus ${timers} timers ship`);
    }
  }
});

test('both guides say the app is not what updates it', () => {
  // The security property is only a property while somebody knows about it.
  // A later session "simplifying" this into a sudoers line would be a
  // reasonable-looking change that turns any web vulnerability into root on
  // an archive of people's identities, and the guides are where the reason
  // is written down for them to find.
  // Read here: this group runs long before the guide-drift group where
  // installMd and docsHtml are bound.
  const guide = fs.readFileSync(new URL('../INSTALL.md', import.meta.url), 'utf8');
  const rendered = fs.readFileSync(new URL('../public/docs.html', import.meta.url), 'utf8');
  for (const [what, raw] of [['INSTALL.md', guide], ['docs.html', rendered]]) {
    // Both files wrap prose, and one of them wraps it inside a blockquote,
    // so a phrase is matched against the text with its whitespace and
    // markup flattened rather than as it happens to be laid out.
    // Two passes, not one: collapsing whitespace in the same pass that
    // strips `**` and `>` leaves the runs of spaces those turn into.
    const text = raw.replace(/<[^>]+>/g, ' ').replace(/[*>&;]/g, ' ').replace(/\s+/g, ' ');
    assert.ok(text.includes('reportlog-update.timer'),
      `${what} does not mention the timer the button needs`);
    assert.ok(text.includes('systemd unit rather than from the checkout'),
      `${what} does not say where the update's remote comes from`);
    assert.ok(text.includes('genuine upstream code'),
      `${what} does not state what an attacker could and could not do`);
  }
});

test('the one root unit never runs code out of the checkout', () => {
  // THE WHOLE SECURITY ARGUMENT. reportlog.service sets
  // ReadWritePaths=/srv/reportlog, so a compromised app can write its own
  // checkout. If the root updater then executed anything from there — node,
  // a repo script, npm as root — the privilege split would buy nothing.
  const sh = fs.readFileSync(new URL('update-apply.sh', contribDir), 'utf8');

  // The remote must come from the unit, never from the repository.
  const unit = fs.readFileSync(new URL('systemd/reportlog-update.service', contribDir), 'utf8');
  assert.match(unit, /Environment=REPORTLOG_REMOTE=/,
    'the unit does not pin the remote, so .git/config decides where code comes from');
  assert.match(sh, /remote get-url origin/, 'the script never compares the repository remote');
  assert.match(sh, /normalize_remote/, 'the remote comparison is not normalised');

  /* AND IT IS RUN, not just named. The normalisation exists because the raw
     comparison refused legitimate deployments whose clone line did not match
     the default — and it went on doing that for one more spelling than the
     first version covered. A test box was cloned over SSH, so its origin read
     `git@github.com:munsdev/reportlog.git` against the unit's plain HTTPS
     URL: same host, same path, same repository, and the updater refused with
     "origin is git@github.com:…, expected https://…", which reads like a
     tampered .git/config and was a clone line.

     A guard that only checks the function is CALLED cannot see that. These
     run the real one, through bash, out of the shipped file. */
  const normalize = (url) => execFileSync('bash', ['-c',
    `${sh.match(/^normalize_remote\(\)\s*\{[\s\S]*?^\}/m)[0]}
normalize_remote "$1"`,
    'x', url], { encoding: 'utf8' });
  const canonical = normalize('https://github.com/munsdev/reportlog.git');
  for (const spelling of [
    'https://github.com/munsdev/reportlog.git',
    'https://github.com/munsdev/reportlog',
    'https://github.com/munsdev/reportlog/',
    'git@github.com:munsdev/reportlog.git',
    'ssh://git@github.com/munsdev/reportlog.git',
  ]) {
    assert.equal(normalize(spelling), canonical,
      `${spelling} is the same repository and the updater would refuse it`);
  }
  /* THE TRIPWIRE IS STILL A TRIPWIRE. Only the transport and its
     punctuation are ignored; the host and the path must still match, so a
     rewritten .git/config pointing somewhere else is caught exactly as
     before. If this ever stops holding, the check has become decoration. */
  for (const other of [
    'git@evil.example:munsdev/reportlog.git',
    'https://evil.example/munsdev/reportlog.git',
    'https://github.com/someone/else.git',
    'https://github.com/munsdev/reportlog-fork.git',
  ]) {
    assert.notEqual(normalize(other), canonical,
      `${other} is a DIFFERENT repository and the updater would accept it`);
  }

  // Every repo-touching command goes through runuser. Root fetches,
  // restarts and writes status; it does not run the project's own code.
  for (const cmd of ['npm ci', 'npm run --silent migrate', 'npm run --silent backup']) {
    const line = sh.split('\n').find((l) => l.includes(cmd) && !l.trim().startsWith('#'));
    assert.ok(line, `update-apply.sh no longer runs: ${cmd}`);
    assert.match(line, /runuser -u "\$APP_USER"/,
      `update-apply.sh runs "${cmd}" as root rather than through runuser`);
  }

  // AND EVERY GIT CALL ON THE CHECKOUT, READS INCLUDED — as a rule rather
  // than a list. This used to name four commands that had to go through
  // runuser, and the four reads nobody listed ran as root. On the first real
  // box the first of them failed: git refuses to read a repository another
  // user owns, the refusal went to /dev/null, and the update was refused as
  // "origin is , expected …". A list only checks what somebody remembered;
  // this checks every line.
  assert.match(sh, /repo_git\(\) \{\s*runuser -u "\$APP_USER" -- git -C "\$REPO" "\$@"/,
    'repo_git no longer runs git as the owner of the checkout');
  const code = sh.split('\n').filter((l) => !l.trim().startsWith('#'));
  const bare = code.filter((l) => /(^|[\s$(;|&])git\s+-C\b/.test(l)
    && !/runuser -u "\$APP_USER" -- git -C/.test(l)
    && !/sudo -u \$APP_USER git -C/.test(l));
  assert.deepEqual(bare, [],
    `update-apply.sh runs git on the checkout as root:\n${bare.join('\n')}`);
  for (const op of ['remote get-url origin', 'rev-parse FETCH_HEAD', 'rev-parse HEAD',
    'merge-base --is-ancestor', 'status --porcelain', 'merge --ff-only']) {
    assert.ok(code.some((l) => l.includes(`repo_git ${op}`)),
      `update-apply.sh no longer reads "${op}" through repo_git`);
  }
  // Not the other fix. Teaching root's git to trust a directory the
  // application can write is the opposite of what this script is for.
  assert.ok(!/safe\.directory/.test(code.join('\n')),
    'update-apply.sh marks the checkout safe for root instead of asking its owner');
  // And the rollback instruction it prints must work when somebody follows
  // it, which as root it would not have.
  assert.match(sh, /Roll back: sudo -u \$APP_USER git -C/,
    'the printed rollback runs git as root and would hit the same refusal');

  // The request may only name what the remote is actually serving.
  assert.match(sh, /\[ "\$TARGET" = "\$TIP" \]/,
    'the script no longer pins the request to the fetched tip');
  // Fast-forward only, so history cannot be rewritten under the deployment.
  assert.match(sh, /merge-base --is-ancestor/, 'the script no longer requires a fast-forward');
  // And a backup before anything is touched.
  assert.ok(sh.indexOf('npm run --silent backup') < sh.indexOf('repo_git merge --ff-only'),
    'the backup must happen BEFORE the code changes, not after');
});

test('the nginx template proxies every path the app answers itself', () => {
  // The mistake this guards against: nginx serves public/ off disk, so a
  // route the app answers and the proxy does not know about is 404ed before
  // Node ever sees it — which looks like the app being broken.
  const conf = fs.readFileSync(new URL('nginx/reportlog.conf', contribDir), 'utf8');
  const serverJs = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');

  // Every top-level mount in server.js that is not under /api.
  const mounts = [...serverJs.matchAll(/app\.(?:use|get)\('(\/[\w-]*)'/g)]
    .map((m) => m[1])
    .filter((p) => p !== '/' && p !== '/api' && !p.startsWith('/api/'));

  for (const mount of [...new Set(mounts)]) {
    assert.ok(conf.includes(mount),
      `server.js answers ${mount} but contrib/nginx/reportlog.conf never proxies it`);
  }
  // And /api itself, which is the bulk of it.
  assert.match(conf, /location \/api\/ \{[\s\S]*?proxy_pass/);
});

test('and forwards the header the app needs to know it is behind TLS', () => {
  // server.js sets `trust proxy`, and req.secure comes from
  // X-Forwarded-Proto. Without it every cookie set with secure:true is
  // dropped, and nobody can stay signed in — for no visible reason.
  const conf = fs.readFileSync(new URL('nginx/reportlog.conf', contribDir), 'utf8');
  assert.match(conf, /X-Forwarded-Proto \$scheme/);
});

/* ------------------------------------------------------------------ */
group('The shipped operator scripts');

// contrib/deploy.sh and contrib/reset-to-fresh.sh are run by hand on a box,
// by somebody who will not read them first. What they must not do matters
// more than what they do.

const deploySh = fs.readFileSync(new URL('../contrib/deploy.sh', import.meta.url), 'utf8');
const resetSh = fs.readFileSync(new URL('../contrib/reset-to-fresh.sh', import.meta.url), 'utf8');

test('deploy.sh is one function called on its last line, so its own git pull cannot corrupt the run', () => {
  // bash reads a script as it runs it. deploy.sh pulls, and the pull can
  // replace deploy.sh; an old copy then carries on from an offset in the new
  // one and skips steps. That is how the nginx reload step was skipped on the
  // first deploy that carried it. A function is parsed whole before it runs.
  assert.match(deploySh, /^main\(\) \{$/m, 'deploy.sh has no main() wrapper');
  const lines = deploySh.trimEnd().split('\n');
  assert.deepEqual(lines.slice(-2), ['main "$@"', 'exit $?'],
    'deploy.sh must end by calling main and exiting, so nothing after it is read');
  assert.ok(deploySh.indexOf('git pull --ff-only') > deploySh.indexOf('main() {'),
    'the git pull is outside main(), where the rewritten file can be re-read');
});

test('the reset never runs configure, which would generate new keys', () => {
  // THE one irreversible mistake available in a reset: new encryption keys
  // against a database that still held data makes every encrypted field
  // unreadable, ciphertext intact in every backup. The reset deliberately
  // leaves .env alone.
  assert.doesNotMatch(resetSh, /npm run (--silent )?configure/,
    'reset-to-fresh.sh runs configure; that would generate new encryption keys');
});

test('and never writes .env at all', () => {
  assert.doesNotMatch(resetSh, />\s*\.env|tee\s+\.env|sed -i.*\.env/,
    'reset-to-fresh.sh writes to .env; every credential worth keeping lives there');
});

test('the reset cannot run without typing the deployment it is aimed at', () => {
  // The only confirmation that cannot be given by reflex, and the only one
  // that catches the real mistake: running it on the wrong box.
  assert.match(resetSh, /read -r TYPED/);
  assert.match(resetSh, /\[ "\$TYPED" = "\$ORIGIN" \]/);
});

test('the reset refuses to drop the schema under a service it could not stop', () => {
  // Run as the service user, whose sudo covers a restart only, the stop used
  // to fail into "(not running)" and the schema went anyway.
  const cmds = resetSh;
  const stopAt = cmds.indexOf('as_root systemctl stop "$SERVICE"');
  assert.ok(stopAt > 0, 'the reset no longer stops the service through as_root');
  assert.match(cmds.slice(stopAt, stopAt + 200), /\|\|\s*fail/,
    'a refused stop must stop the reset');
  assert.ok(stopAt < cmds.indexOf('DROP SCHEMA'), 'the stop must come before the drop');
});

test('and starts again every timer it stopped, the anchor included', () => {
  // A fixed restart list once left reportlog-anchor.timer stopped for good.
  assert.match(resetSh, /STOPPED_TIMERS\+=\("\$t"\)/);
  assert.match(resetSh, /for t in "\$\{STOPPED_TIMERS\[@\]\}"; do/);
});

test('deploy refuses to run over uncommitted changes', () => {
  assert.match(deploySh, /git status --porcelain/);
  assert.match(deploySh, /uncommitted changes/);
});

test('deploy fast-forwards only, and never merges on the box', () => {
  // A merge on a deployment is a commit that exists nowhere else, and the
  // next deploy then refuses for a reason nobody can see.
  assert.match(deploySh, /git pull --ff-only/);
  assert.doesNotMatch(deploySh, /git (pull|merge)(?!.*--ff-only)[^\n]*\n/);
});

// Commands only. Both these scripts EXPLAIN themselves in comments, and a
// comment saying "npm ci and not npm install" must not read as an npm
// install — which is exactly what a naive match did.
const commandsOf = (sh) => sh.split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .join('\n');

test('deploy installs from the lockfile, not from package.json', () => {
  // npm ci fails when the two disagree, which is the check that has caught
  // a bad release twice. npm install would paper over it.
  const cmds = commandsOf(deploySh);
  assert.match(cmds, /npm ci --omit=dev/);
  assert.doesNotMatch(cmds, /npm install/);
});

test('deploy restarts last, after dependencies and migrations', () => {
  // Ordered so a failure stops before it touches the running service.
  //
  // Matched on the actual invocation, not on the string anywhere: the
  // early "nothing to deploy" branch and the rollback advice both mention
  // `systemctl restart` in prose, and the first of those comes before
  // everything — which made this assertion fail on a correct script.
  const cmds = commandsOf(deploySh);
  const ciAt = cmds.indexOf('npm ci --omit=dev');
  const migrateAt = cmds.indexOf('npm run migrate');
  const restartAt = cmds.indexOf('sudo systemctl restart "$SERVICE" ||');
  assert.ok(ciAt > 0, 'npm ci is missing');
  assert.ok(migrateAt > ciAt, 'migrate should come after npm ci');
  assert.ok(restartAt > migrateAt, 'the restart should come after the migrations');
});

test('deploy checks the service came back, and says how to roll back', () => {
  // "Deployed" without a health check is a deploy that reports success for
  // a process that is crash-looping on the new code.
  assert.match(deploySh, /api\/health/);
  assert.match(deploySh, /git reset --hard/);
});

test('both scripts are executable and shipped', () => {
  for (const f of ['deploy.sh', 'reset-to-fresh.sh']) {
    const st = fs.statSync(new URL(`../contrib/${f}`, import.meta.url));
    // 0o111 — executable by somebody, or `./contrib/deploy.sh` fails with
    // permission denied after a fresh clone.
    assert.ok(st.mode & 0o111, `contrib/${f} is not executable`);
  }
});

/* ------------------------------------------------------------------ */
group('The lockfile agrees with package.json');

// A rule in prose is not a check, and this one was a rule in prose that got
// missed twice on the other project. contrib/deploy.sh installs with
// `npm ci`, which fails outright when these two disagree — correctly, but
// on the SERVER, half way through a deploy, after the pull. This is the
// same check one step earlier, where it costs nothing.

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('the lockfile is for this package, at this version', () => {
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version,
    `package.json says ${pkg.version} and the lockfile says ${lock.version} —`
    + ' bump both, or npm ci dies at the install step on the box');
  // npm writes the version in two places and updates both. A mismatch here
  // means somebody hand-edited one.
  assert.equal(lock.packages?.['']?.version, pkg.version);
});

test('every dependency it declares is locked', () => {
  const declared = { ...(pkg.dependencies || {}) };
  const locked = lock.packages?.['']?.dependencies || {};
  for (const name of Object.keys(declared)) {
    assert.equal(locked[name], declared[name],
      `${name} is ${declared[name]} in package.json and ${locked[name] ?? 'absent'} in the lockfile`);
  }
  // And nothing locked that is no longer declared, which is what a removed
  // dependency leaves behind.
  for (const name of Object.keys(locked)) {
    assert.ok(name in declared, `${name} is locked but no longer declared`);
  }
});

/* ------------------------------------------------------------------ */
group('Every selftest has somewhere to run');

// Four selftest scripts sat in scripts/ for weeks with nothing running them.
// They were not broken and not abandoned — they simply had no home, because
// `npm test` is pure and they need a database. `npm run test:db` is that
// home. This check is what stops the fifth one going the same way: adding a
// selftest script that nothing invokes now fails the suite that does run.

const scriptsDir = new URL('../scripts/', import.meta.url);
const selftestScripts = fs.readdirSync(scriptsDir)
  .filter((f) => f.endsWith('-selftest.mjs'));
const dbRunner = fs.readFileSync(new URL('db-selftest.js', scriptsDir), 'utf8');

test('there are selftest scripts to account for', () => {
  assert.ok(selftestScripts.length >= 4,
    `expected the known selftest scripts, found ${selftestScripts.length}`);
});

test('and the database suite runs every one of them', () => {
  const orphaned = selftestScripts.filter((f) => !dbRunner.includes(f));
  assert.deepEqual(orphaned, [],
    `nothing runs these: ${orphaned.join(', ')} — add them to scripts/db-selftest.js`);
});

/* ------------------------------------------------------------------ */
group('Logbooks are the only forms');

const reportsRoute = stripComments(fs.readFileSync(new URL('../src/routes/reports.js', import.meta.url), 'utf8'));

test('a report cannot be filed without naming a logbook', () => {
  assert.match(reportsRoute, /if \(!b\.logbook\)/);
  assert.match(reportsRoute, /Choose which logbook this report is for/);
});

test('the spine is an address, consent and the publication answer — no written account', () => {
  const spine = reportsRoute.slice(reportsRoute.indexOf('function validateSpine'),
    reportsRoute.indexOf('function validateSpine') + 800);
  assert.match(spine, /looksLikeEmail/);
  assert.match(spine, /consent/);
  assert.match(spine, /may_publish/);
  assert.ok(!/narrative/.test(spine), 'a written account is a question a logbook asks, not the spine');
});

test('nothing in the software offers a built-in questionnaire any more', () => {
  for (const gone of ['structured.js', 'formMode.js', 'countyThreshold.js', 'categoryCatalogue.js', 'alerts.js']) {
    assert.ok(!fs.existsSync(new URL(`../src/${gone}`, import.meta.url)), `${gone} is back`);
  }
  const page = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const card of ['reporter', 'where', 'when', 'category', 'narrative', 'impact', 's-outcome']) {
    assert.ok(!page.includes(`data-card="${card}"`), `the ${card} card is back on the form`);
  }
});

test('migration 029 refuses to run on an archive that holds reports', () => {
  const m = fs.readFileSync(new URL('../migrations/029_logbooks_only.sql', import.meta.url), 'utf8');
  assert.match(m, /IF EXISTS \(SELECT 1 FROM reports\) THEN\s+RAISE EXCEPTION/);
  // The refusal comes before anything is changed.
  assert.ok(m.indexOf('RAISE EXCEPTION') < m.indexOf('DROP COLUMN'));
});

group('A logbook as a file');

const goodFile = () => ({
  reportlog_logbook: LOGBOOK_FILE_VERSION,
  title: 'Night shift',
  questions: [
    { key: 'what', kind: 'choice_one', label: 'What happened?', required: true, options: ['A', 'B'] },
    { kind: 'long_text', label: 'Tell us more' },
  ],
});

test('a well-formed file has nothing wrong with it', () => {
  assert.deepEqual(validateLogbookFile(goodFile()), []);
});

test('what is wrong is said in sentences, all at once', () => {
  const bad = { reportlog_logbook: 99, title: '', questions: [
    { kind: 'nonsense', label: 'x' },
    { kind: 'choice_one', label: 'Pick', options: [] },
    { key: 'Bad Key', kind: 'date', label: 'When' },
  ] };
  const errs = validateLogbookFile(bad);
  assert.ok(errs.length >= 4, errs.join(' | '));
  assert.ok(errs.every((e) => /\.$/.test(e)), 'each problem is a sentence');
});

test('a file with no questions is refused — a report is its answers', () => {
  assert.ok(validateLogbookFile({ ...goodFile(), questions: [] }).length);
});

test('a repeated key is refused, since the key is what an answer is sealed under', () => {
  const f = goodFile();
  f.questions.push({ key: 'what', kind: 'date', label: 'Again' });
  assert.ok(validateLogbookFile(f).some((e) => /repeats the key/.test(e)));
});

test('an upload always makes a draft — the file module launches nothing', () => {
  const src = stripComments(fs.readFileSync(new URL('../src/logbookFile.js', import.meta.url), 'utf8'));
  assert.ok(!/\blaunch\b/.test(src));
  assert.ok(!/launched_at/.test(src));
});

group('One chain per logbook');

test('each logbook starts from its own value, recomputable from its slug', () => {
  assert.equal(chainGenesis('election-day'), sha256Hex('reportlog-chain:election-day'));
  assert.notEqual(chainGenesis('a'), chainGenesis('b'));
  // The standalone checker agrees with the server, without importing it.
  assert.equal(genesisOf('election-day'), chainGenesis('election-day'));
});

test('the insert links to the newest row in the SAME logbook, under that logbook\'s lock', () => {
  const core = stripComments(fs.readFileSync(new URL('../src/reportCore.js', import.meta.url), 'utf8'));
  assert.match(core, /WHERE logbook_id = \$1 ORDER BY id DESC LIMIT 1/);
  assert.match(core, /reports_chain:\$\{logbookId\}/);
  assert.match(core, /chainGenesis\(fields\.logbook\)/);
  assert.ok(!/GENESIS_HASH/.test(core), 'no report starts from the old single chain\'s zeros');
});

test('verify.js checks position within the logbook, not across the archive', () => {
  const v = stripComments(fs.readFileSync(new URL('../src/verify.js', import.meta.url), 'utf8'));
  assert.match(v, /WHERE logbook_id = \$1 AND id < \$2/);
  assert.match(v, /chainGenesis\(row\.logbook_slug\)/);
});

// A tiny chain built the way the server builds one, to hand the checker.
function chainOf(slug, n) {
  let prev = chainGenesis(slug);
  const reports = [];
  for (let i = 0; i < n; i += 1) {
    const hashed = {
      public_ref: `RL-${i}`, received_at: '2026-11-03T10:00:00.000Z', thread_id: `t${i}`,
      corrects_id: null, logbook: slug, may_publish: true, may_publish_digest: DIGEST,
    };
    const content = contentHash(hashed);
    const link = chainHash(content, prev);
    reports.push({ public_ref: hashed.public_ref, hashed_fields: hashed,
      content_hash: content, prev_chain_hash: prev, chain_hash: link });
    prev = link;
  }
  return {
    chain_file_format: CHAIN_FILE_FORMAT, kind: 'complete', logbook: slug,
    genesis: chainGenesis(slug), chain_length: n,
    anchors: n ? [{ date: '2026-11-04', head: prev, reports: n }] : [], reports,
  };
}

test('an intact chain file checks out, with no database', () => {
  const out = checkChainFile(chainOf('lb', 3));
  assert.deepEqual(out.problems, []);
  assert.equal(out.checked, 3);
});

test('an edited answer, a removed report and a moved report are all caught', () => {
  const edited = chainOf('lb', 3);
  edited.reports[1].hashed_fields.may_publish = false;
  assert.ok(checkChainFile(edited).problems.some((p) => /fingerprint/.test(p)));

  const removed = chainOf('lb', 3);
  removed.reports.splice(1, 1);
  removed.chain_length = 2;
  assert.ok(checkChainFile(removed).problems.some((p) => /does not follow/.test(p)));

  // A report lifted from another logbook's chain names the wrong logbook
  // and follows the wrong start.
  const moved = chainOf('lb', 1);
  moved.reports = chainOf('other', 1).reports;
  const got = checkChainFile(moved).problems.join(' | ');
  assert.match(got, /another logbook/);
});

test('an anchor that disagrees with the chain is named', () => {
  const f = chainOf('lb', 2);
  f.anchors = [{ date: '2026-11-04', head: f.reports[0].chain_hash, reports: 2 }];
  assert.ok(checkChainFile(f).problems.some((p) => /anchor of 2026-11-04/.test(p)));
});

group('The withdrawn veracity verdict');

test('nothing exports a veracity vocabulary for anything to use', async () => {
  // The verdict is withdrawn (src/taxonomy.js says why at length). What is
  // left is one frozen key list, kept so /api/v1/stats can honour the
  // promise in public/api.html not to remove a field without a v2.
  const tax = await import('../src/taxonomy.js');
  assert.ok(!('VERACITY_VALUES' in tax), 'the verdict vocabulary is back');
  assert.ok(!('VERACITY_LABELS' in tax), 'the verdict labels are back');
  assert.deepEqual(tax.VERACITY_FROZEN_KEYS, ['pending', 'proven_false',
    'likely_false', 'undetermined', 'likely_true', 'proven_true'],
  'the frozen key list is what /api/v1 publishes; changing it retypes a promised field');
});

test('there is no way to filter a board by a verdict nothing writes', async () => {
  const search = await import('../src/reportSearch.js');
  assert.ok(!('veracityClause' in search), 'the filter is back');
  assert.ok(!('VERACITY_FILTER_VALUES' in search));
});

test('no route sets a veracity, and the moderator screen offers no control', () => {
  // Both halves, because either one alone is a half-removal: a route with no
  // button is still reachable with curl, and a button with no route is a
  // control that fails.
  const mods = fs.readFileSync(new URL('../src/routes/moderators.js', import.meta.url), 'utf8');
  assert.doesNotMatch(mods, /router\.post\([^)]*veracity/, 'the route is back');
  assert.doesNotMatch(mods, /UPDATE report_heads SET veracity/, 'something writes the column');

  // THE CONTROLS, not the word. This banned /veracity/i and then went red on
  // the editorial-note modal's own explanation of what it replaced — which
  // is prose worth having. What must not come back is a way to SET or FILTER
  // a verdict.
  const page = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const control of ['ovl-veracity', 'name="vrc"', 'f-veracity', 'modsf-veracity']) {
    assert.ok(!page.includes(control), `${control} is back in the markup`);
  }

  const board = fs.readFileSync(new URL('../public/js/board.js', import.meta.url), 'utf8');
  assert.doesNotMatch(board, /data-veracity/, 'the Set veracity button is back');
  // The chip is the one that mattered: a coloured verdict printed over an
  // account that names somebody.
  assert.doesNotMatch(board, /VERACITY_COLOR/, 'the verdict chip is back on the card');
});

test('but /api/v1 keeps the field it promised, reading pending for everything', () => {
  // THE PROMISE. public/api.html: an existing field is not renamed, retyped
  // or removed without a /api/v2. Removing by_veracity quietly would stop
  // somebody's dashboard with no way to tell them, so it stays until there
  // is a v2 — and api.html has to say so, or a frozen field is just a lie
  // that happens to parse.
  const stats = fs.readFileSync(new URL('../src/stats.js', import.meta.url), 'utf8');
  assert.match(stats, /by_veracity/, 'the promised field was dropped');
  assert.match(stats, /VERACITY_FROZEN_KEYS/, 'it is no longer built from the frozen list');

  const api = fs.readFileSync(new URL('../public/api.html', import.meta.url), 'utf8');
  assert.match(api, /Withdrawn, and frozen/, 'the field table does not say the field is withdrawn');
  assert.match(api, /api\/v2/, 'nothing tells a reader when it goes');
  assert.match(api, /does not publish a verdict on whether an account\s+is true/,
    'the page still implies the archive judges truth');
});

test('the stats breakdown is counted from the column, not hardcoded to zeros', () => {
  // A deployment that recorded verdicts BEFORE the withdrawal keeps
  // reporting them. Zeroing the field would be this software rewriting a
  // deployment's own history on deploy, which is the one thing it exists to
  // make impossible.
  const stats = fs.readFileSync(new URL('../src/stats.js', import.meta.url), 'utf8');
  assert.match(stats, /published\.filter\(\(r\) => r\.veracity === k\)/,
    'the breakdown stopped reading what was actually recorded');
});

group('The form a report was answered against');

const Q = (o = {}) => ({ key: 'what', kind: 'short_text', label: 'What?', help: null,
  required: true, filterable: false, settings: {}, position: 0, ...o });

test('a form hashes the same however its optional parts were spelled', () => {
  const a = formText('lb', [Q({ help: null })]);
  assert.equal(a.hash, formText('lb', [Q({ help: '' })]).hash);
  assert.equal(a.hash, formText('lb', [Q({ help: undefined })]).hash);
  assert.ok(!('help' in formDefinition('lb', [Q()]).questions[0]), 'no help, no key');
  assert.equal(formText('lb', [Q({ settings: { a: 1, b: 2 } })]).hash,
    formText('lb', [Q({ settings: { b: 2, a: 1 } })]).hash);
  assert.equal(a.hash, sha256Hex(a.definition));
});

test('what changes a question\'s meaning changes the hash; delivery does not', () => {
  const base = formText('lb', [Q()]).hash;
  assert.notEqual(base, formText('lb', [Q({ label: 'What happened?' })]).hash);
  assert.notEqual(base, formText('lb', [Q({ help: 'Say it plainly.' })]).hash);
  assert.notEqual(base, formText('lb', [Q({ required: false })]).hash);
  assert.notEqual(base, formText('lb', [Q({ kind: 'long_text' })]).hash);
  assert.notEqual(base, formText('lb', [Q({ settings: { options: ['x'] } })]).hash);
  assert.notEqual(base, formText('lb', [Q(), Q({ key: 'more', label: 'More?', required: false })]).hash);
  assert.notEqual(base, formText('other', [Q()]).hash);
  // The board filter is not a question, and where a question sits in the
  // table is not what it asks.
  assert.equal(base, formText('lb', [Q({ filterable: true, position: 9, id: 4 })]).hash);
});

test('a form with no conditions hashes exactly as it did before they existed', () => {
  // THE MOST IMPORTANT CHECK IN THIS BLOCK. `shown_when` is sealed into the
  // definition, so writing the key unconditionally would change the hash of
  // every form in existence — and break the `logbook_form` seal of every
  // report ever filed against them. Migration 034 says so at length; this
  // is what stops a later tidy-up doing it.
  const a = formText('lb', [Q({ shown_when: null })]);
  assert.equal(a.hash, formText('lb', [Q({ shown_when: undefined })]).hash);
  assert.equal(a.hash, formText('lb', [Q()]).hash);
  assert.ok(!('shown_when' in formDefinition('lb', [Q()]).questions[0]),
    'no condition, no key — an absent key and a null one hash differently');
});

test('a condition is part of what a question means, so it changes the hash', () => {
  const base = formText('lb', [Q()]).hash;
  const cond = { field: 'has_files', in: ['yes'] };
  assert.notEqual(base, formText('lb', [Q({ shown_when: cond })]).hash);
  // And two different conditions are two different questions: "asked when
  // they said yes" and "asked when they said no" are not the same form.
  assert.notEqual(
    formText('lb', [Q({ shown_when: cond })]).hash,
    formText('lb', [Q({ shown_when: { field: 'has_files', in: ['no'] } })]).hash,
  );
});

group('When a question is asked');

const F = (o = {}) => ({ key: 'has_files', kind: 'yes_no', label: 'Any files?', settings: {}, ...o });
const CHOICE = (o = {}) => F({
  key: 'what', kind: 'choice_one', label: 'What went wrong?',
  settings: { options: ['Long lines', 'Turned away', 'Equipment'] }, ...o,
});

test('a condition names an earlier question, a kind with countable answers, and real values', () => {
  const earlier = [F(), CHOICE()];
  assert.deepEqual(
    normalizeCondition({ field: 'has_files', in: ['yes'] }, earlier).condition,
    { field: 'has_files', in: ['yes'] },
  );
  assert.equal(normalizeCondition(null, earlier).condition, null, 'no condition is fine');
  assert.equal(normalizeCondition(undefined, earlier).condition, null);
  assert.equal(normalizeCondition({ field: 'nope', in: ['yes'] }, earlier).reason, 'unknown-field');
  assert.equal(normalizeCondition({ in: ['yes'] }, earlier).reason, 'no-field');
  assert.equal(normalizeCondition({ field: 'has_files', in: [] }, earlier).reason, 'no-values');
  assert.equal(normalizeCondition({ field: 'has_files', in: ['maybe'] }, earlier).reason, 'unknown-value');
  assert.equal(normalizeCondition({ field: 'what', in: ['Nonexistent'] }, earlier).reason, 'unknown-value');
  assert.equal(normalizeCondition('yes', earlier).reason, 'shape');
});

test('a condition cannot look forward, so conditions cannot cycle', () => {
  // The guard is positional: `earlier` is only the questions before this
  // one. A question answered on card 9 cannot decide whether card 4 is put,
  // and refusing that is also what makes a cycle impossible to express.
  assert.equal(normalizeCondition({ field: 'has_files', in: ['yes'] }, []).reason, 'unknown-field');
  assert.equal(normalizeCondition({ field: 'later', in: ['yes'] }, [F()]).reason, 'unknown-field');
});

test('a condition cannot be asked about free prose', () => {
  const prose = F({ key: 'account', kind: 'long_text', settings: {} });
  assert.equal(normalizeCondition({ field: 'account', in: ['police'] }, [prose]).reason, 'kind');
  // Nor a place, which allows anything typed and so is not a fixed set.
  const place = F({ key: 'where', kind: 'place', settings: { options: ['Ohio'], allowOther: true } });
  assert.equal(normalizeCondition({ field: 'where', in: ['Ohio'] }, [place]).reason, 'kind');
});

test('a condition\'s values are stored in the target\'s order, not the operator\'s', () => {
  // It is sealed into the form definition, so two operators writing the same
  // condition with the values in a different order must produce one hash.
  const earlier = [CHOICE()];
  const a = normalizeCondition({ field: 'what', in: ['Equipment', 'Long lines'] }, earlier).condition;
  const b = normalizeCondition({ field: 'what', in: ['Long lines', 'Equipment'] }, earlier).condition;
  assert.deepEqual(a, b);
  assert.deepEqual(a.in, ['Long lines', 'Equipment'], 'the operator\'s option order');
  // Duplicates collapse, for the same reason.
  assert.deepEqual(
    normalizeCondition({ field: 'what', in: ['Equipment', 'Equipment'] }, earlier).condition.in,
    ['Equipment'],
  );
});

test('an unanswered controlling question means the dependent is not asked', () => {
  const c = { field: 'has_files', in: ['yes'] };
  assert.equal(conditionMet(c, {}), false, 'not shown by default');
  assert.equal(conditionMet(c, { has_files: undefined }), false);
  assert.equal(conditionMet(c, { has_files: null }), false);
  assert.equal(conditionMet(c, { has_files: true }), true);
  assert.equal(conditionMet(c, { has_files: false }), false);
  assert.equal(conditionMet(null, {}), true, 'no condition is always asked');
});

test('a condition reads every answer shape the form can produce', () => {
  // yes_no seals a boolean; the form hands back the string. Both have to
  // work, because the server sees one and the browser the other.
  assert.equal(conditionMet({ field: 'q', in: ['yes'] }, { q: true }), true);
  assert.equal(conditionMet({ field: 'q', in: ['yes'] }, { q: 'yes' }), true);
  assert.equal(conditionMet({ field: 'q', in: ['no'] }, { q: false }), true);
  assert.equal(conditionMet({ field: 'q', in: ['no'] }, { q: 'no' }), true);
  // choice_one is a string.
  assert.equal(conditionMet({ field: 'q', in: ['a', 'b'] }, { q: 'b' }), true);
  assert.equal(conditionMet({ field: 'q', in: ['a', 'b'] }, { q: 'c' }), false);
  // choice_many is an array, and any overlap counts.
  assert.equal(conditionMet({ field: 'q', in: ['a'] }, { q: ['c', 'a'] }), true);
  assert.equal(conditionMet({ field: 'q', in: ['a'] }, { q: ['c'] }), false);
  assert.equal(conditionMet({ field: 'q', in: ['a'] }, { q: [] }), false);
});

test('visibility cascades, so a question behind a hidden question is hidden too', () => {
  const fields = [
    F(),
    F({ key: 'clip_of', kind: 'short_text', shown_when: { field: 'has_files', in: ['yes'] } }),
    F({ key: 'always', kind: 'short_text' }),
  ];
  assert.deepEqual([...askedKeys(fields, {})], ['has_files', 'always']);
  assert.deepEqual([...askedKeys(fields, { has_files: true })],
    ['has_files', 'clip_of', 'always']);
  assert.deepEqual([...askedKeys(fields, { has_files: false })], ['has_files', 'always']);
});

test('THE TWO COPIES OF conditionMet AGREE, answer for answer', async () => {
  // There is no build step and nginx serves public/ directly, so the browser
  // cannot import src/conditions.js and the logic exists twice. This is the
  // only thing that makes that acceptable: one table of cases through both.
  // If they ever disagree, a reporter is shown a question whose answer the
  // server then drops — or not shown one whose answer it demands.
  const client = await import('../public/js/conditions.js');
  const cases = [];
  const conds = [
    null,
    { field: 'q', in: ['yes'] },
    { field: 'q', in: ['no'] },
    { field: 'q', in: ['a'] },
    { field: 'q', in: ['a', 'b'] },
    { field: 'missing', in: ['a'] },
  ];
  const answerSets = [
    {}, { q: true }, { q: false }, { q: 'yes' }, { q: 'no' },
    { q: 'a' }, { q: 'b' }, { q: 'c' }, { q: [] }, { q: ['a'] }, { q: ['b', 'a'] },
    { q: null }, { q: undefined }, { other: 'a' },
  ];
  for (const c of conds) {
    for (const a of answerSets) {
      cases.push([c, a, conditionMet(c, a), client.conditionMet(c, a)]);
    }
  }
  const disagreed = cases.filter(([, , server, browser]) => server !== browser);
  assert.equal(disagreed.length, 0,
    `these disagree: ${JSON.stringify(disagreed.slice(0, 3))}`);
  assert.ok(cases.length >= 80, 'the table is meant to be wide');
  // And a sanity check that the table is not all one answer, which would
  // make the agreement meaningless.
  assert.ok(cases.some(([, , v]) => v === true) && cases.some(([, , v]) => v === false));
});

test('a condition describes itself in a line an operator can check', () => {
  const fields = [F(), CHOICE()];
  assert.match(describeCondition({ field: 'has_files', in: ['yes'] }, fields),
    /Any files\?.*yes/);
  assert.match(describeCondition({ field: 'what', in: ['Long lines'] }, fields),
    /What went wrong\?.*Long lines/);
  assert.equal(describeCondition(null, fields), '');
});

test('a hidden question seals nothing, and its required does not apply', () => {
  const fields = [
    { key: 'has_files', kind: 'yes_no', label: 'Any files?', required: true, settings: {} },
    {
      key: 'clip_of', kind: 'short_text', label: 'What is it of?', required: true, settings: {},
      shown_when: { field: 'has_files', in: ['yes'] },
    },
  ];
  // Said no: the dependent is not asked, so no error and no sealed answer —
  // even though it is marked required.
  const no = buildAnswers(fields, { has_files: 'no', clip_of: 'a stale answer' });
  assert.deepEqual(no.errors, [], 'a question nobody was asked cannot be missing');
  assert.deepEqual(no.answers, { has_files: false });
  assert.ok(!('clip_of' in no.answers), 'and a stale answer to it is not sealed');

  // Said yes and answered: both sealed.
  const yes = buildAnswers(fields, { has_files: 'yes', clip_of: 'thirty seconds of the line' });
  assert.deepEqual(yes.answers, { has_files: true, clip_of: 'thirty seconds of the line' });

  // Said yes and did not answer: now it really is missing.
  const missing = buildAnswers(fields, { has_files: 'yes' });
  assert.equal(missing.errors.length, 1);
  assert.match(missing.errors[0], /What is it of/);
});

test('a row with a form is rebuilt with its hash, a row without one is rebuilt without the key', () => {
  const row = {
    public_ref: 'RL-1', received_at: new Date('2026-11-03T10:00:00Z'), thread_id: 't',
    corrects_id: null, recipe: 1, logbook_slug: 'lb', answers: { what: 'x' },
    may_publish: true, may_publish_digest: DIGEST, third_party: null,
  };
  const without = immutableFieldsFor(row, null);
  assert.ok(!('logbook_form' in without), 'a report filed before forms has no such key');
  const withForm = immutableFieldsFor({ ...row, form_id: 3, logbook_form: 'a'.repeat(64) }, null);
  assert.equal(withForm.logbook_form, 'a'.repeat(64));
  assert.notEqual(contentHash(without), contentHash(withForm));
  assert.throws(() => immutableFieldsFor({ ...row, form_id: 3 }, null), /join logbook_forms/,
    'a row fetched without the join must not quietly rebuild a different object');
});

test('the insert seals the form and writes the same version to the row', () => {
  const core = stripComments(fs.readFileSync(new URL('../src/reportCore.js', import.meta.url), 'utf8'));
  assert.match(core, /logbook_form: formHash/);
  assert.match(core, /resolvedFormId,\n/);
  assert.ok(!/import .*logbooks\.js/.test(core.split('export')[0]), 'reportCore stays loadable with no database');
});

test('every route that files a report names the form it checked answers against', () => {
  for (const f of ['reports', 'me', 'intake']) {
    const src = stripComments(fs.readFileSync(new URL(`../src/routes/${f}.js`, import.meta.url), 'utf8'));
    assert.match(src, /ensureFormVersion\(/, `${f}.js resolves the form its answers were checked against`);
    assert.match(src, /formId/, `${f}.js hands it to insertReportVersion`);
  }
});

// A chain whose reports carry a form, the way the server writes one.
function chainWithForm(answers, questions) {
  const f = chainOf('lb', 1);
  const form = formText('lb', questions);
  const r = f.reports[0];
  r.hashed_fields = { ...r.hashed_fields, logbook_form: form.hash, ...(answers ? { answers } : {}) };
  r.content_hash = contentHash(r.hashed_fields);
  r.chain_hash = chainHash(r.content_hash, r.prev_chain_hash);
  f.anchors = [{ date: '2026-11-04', head: r.chain_hash, reports: 1 }];
  f.forms = [{ hash: form.hash, definition: form.definition }];
  return f;
}
const QS = [Q(), Q({ key: 'more', label: 'More?', required: false })];

test('a chain file with its forms checks out, and each answer is to a question that was asked', () => {
  assert.deepEqual(checkChainFile(chainWithForm({ what: 'x' }, QS)).problems, []);
  assert.deepEqual(checkChainFile(chainWithForm({ what: 'x', more: 'y' }, QS)).problems, []);
});

test('the checker catches a missing form, an edited form, a foreign answer and a skipped required one', () => {
  const missing = chainWithForm({ what: 'x' }, QS);
  missing.forms = [];
  assert.match(checkChainFile(missing).problems.join('|'), /does not carry them/);

  const edited = chainWithForm({ what: 'x' }, QS);
  edited.forms[0].definition = edited.forms[0].definition.replace('What?', 'Who?');
  assert.match(checkChainFile(edited).problems.join('|'), /form in the file does not match/);

  const foreign = chainWithForm({ what: 'x', nope: 'y' }, QS);
  assert.match(checkChainFile(foreign).problems.join('|'), /answers "nope"/);

  const skipped = chainWithForm({ more: 'y' }, QS);
  assert.match(checkChainFile(skipped).problems.join('|'), /leaves out "what"/);

  const other = chainWithForm({ what: 'x' }, QS);
  const alien = formText('other', QS);
  other.forms = [{ hash: alien.hash, definition: alien.definition }];
  assert.match(checkChainFile(other).problems.join('|'), /not this logbook's/);
});

test('a chain file from before forms, with none, still checks out', () => {
  assert.deepEqual(checkChainFile(chainOf('lb', 2)).problems, []);
});

test('the daily timestamp covers the whole list, and the list is recomputable', () => {
  const heads = [{ logbook: 'a', head: 'x'.repeat(64), reports: 1 }];
  assert.equal(headsDigest('2026-11-04', heads),
    sha256Hex(canonicalize({ anchor_format: ANCHOR_FORMAT, date: '2026-11-04', chains: heads })));
  assert.notEqual(headsDigest('2026-11-04', heads),
    headsDigest('2026-11-04', [{ ...heads[0], reports: 2 }]));
});

test('the anchor refuses a list that drops a logbook or shortens a chain', () => {
  const a = stripComments(fs.readFileSync(new URL('./anchor.js', import.meta.url), 'utf8'));
  assert.match(a, /contradictions\(heads\)/);
  assert.match(a, /process\.exit\(2\)/);
  assert.ok(a.indexOf('contradictions(heads)') < a.indexOf('openssl'),
    'it checks before anything is timestamped');
});


/* ---------------------------------------------------------------------- *
 * The install checks: who answered a path, what systemd is set to run,
 * and whether there is a recent backup.
 * ---------------------------------------------------------------------- */

test('a 200 from nginx for the manifest is NOT read as the app answering', () => {
  // THE TEST THIS WHOLE CHECK EXISTS FOR. A missing location block for a path
  // that is also a file on disk does not 404 — nginx serves the file, with a
  // 200, and nothing looks wrong. The marker is the app's own no-cache header.
  const fromDisk = { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: '{}' };
  assert.equal(whoAnswered('no-cache', fromDisk), 'nginx');

  const fromApp = {
    status: 200,
    headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' },
    body: '{"name":"Somewhere"}',
  };
  assert.equal(whoAnswered('no-cache', fromApp), 'app');
});

test('the SPA fallback answering /docs is caught, and a real page is not', () => {
  const spa = { status: 200, headers: {}, body: `<div ${SPA_MARKER}></div>` };
  assert.equal(whoAnswered('not-spa', spa), 'nginx');
  const real = { status: 200, headers: {}, body: '<h1>Standing up ReportLog</h1>' };
  assert.equal(whoAnswered('not-spa', real), 'app');
});

test('an unreadable marker is never reported as a pass', () => {
  // 'unknown' has to stay distinct from 'app'. A green tick somebody relies on
  // is worse than an honest "cannot tell".
  assert.equal(whoAnswered('not-spa', { status: 200, headers: {}, body: '' }), 'unknown');
  assert.equal(whoAnswered('json-ok', null), 'unknown');
  assert.equal(whoAnswered('no-such-marker', { status: 200, headers: {}, body: 'x' }), 'unknown');
});

test('health is only the app when the body really says so', () => {
  assert.equal(whoAnswered('json-ok', { status: 200, headers: {}, body: '{"ok":true}' }), 'app');
  assert.equal(whoAnswered('json-ok', { status: 200, headers: {}, body: '<html>' }), 'nginx');
  assert.equal(whoAnswered('json-ok', { status: 404, headers: {}, body: '{"ok":true}' }), 'nginx');
});

test('every proxied path names a marker this can actually read', () => {
  assert.ok(PROXIED_PATHS.length >= 5);
  for (const p of PROXIED_PATHS) {
    assert.ok(p.path.startsWith('/'), `${p.path} is not a path`);
    assert.ok(p.what, `${p.path} does not say what it is for`);
    assert.ok(['json-ok', 'no-cache', 'not-spa'].includes(p.marker),
      `${p.path} uses a marker whoAnswered does not implement`);
  }
});

test('the SPA marker is really in index.html and in none of the pages it stands in for', () => {
  // If this marker ever stops being unique to index.html, the /docs check
  // starts reporting a correct deployment as broken.
  const read = (f) => fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
  assert.ok(read('index.html').includes(SPA_MARKER));
  for (const f of ['docs.html', 'styleguide.html', 'app.html']) {
    assert.ok(!read(f).includes(SPA_MARKER), `${f} carries the SPA marker`);
  }
});

test('systemctl output is parsed into the units that are actually enabled', () => {
  const out = [
    'UNIT FILE                      STATE           PRESET',
    'reportlog.service              enabled         enabled',
    'reportlog-anchor.service       static          -',
    'reportlog-anchor.timer         enabled         enabled',
    'reportlog-backup.timer         disabled        enabled',
    'reportlog-sweep.timer          masked          -',
    '',
  ].join('\n');
  const enabled = parseEnabledUnits(out);
  assert.deepEqual([...enabled].sort(), ['reportlog-anchor.timer', 'reportlog.service']);
  // disabled, masked and static are all "will not start on boot"
  assert.ok(!enabled.has('reportlog-backup.timer'));
  assert.ok(!enabled.has('reportlog-sweep.timer'));
  assert.ok(!enabled.has('reportlog-anchor.service'));
});

test('an empty or junk systemctl answer yields no units rather than throwing', () => {
  assert.equal(parseEnabledUnits('').size, 0);
  assert.equal(parseEnabledUnits(null).size, 0);
  assert.equal(parseEnabledUnits('0 unit files listed.').size, 0);
});

test('a missing anchor timer is required; a missing sweep timer is not', () => {
  // The anchor was once missing from an instructions list and a deployment
  // never anchored. That is the case this has to fault.
  const { all, required } = missingUnits(new Set(['reportlog.service']), { attachments: false });
  const names = required.map((u) => u.unit);
  assert.ok(names.includes('reportlog-anchor.timer'));
  assert.ok(names.includes('reportlog-backup.timer'));
  assert.ok(!names.includes('reportlog-sweep.timer'), 'sweep is optional');
  assert.ok(all.map((u) => u.unit).includes('reportlog-sweep.timer'), 'but it is still reported');
});

test('the media worker is required only where attachments are on', () => {
  const off = missingUnits(new Set(), { attachments: false }).required.map((u) => u.unit);
  const on = missingUnits(new Set(), { attachments: true }).required.map((u) => u.unit);
  assert.ok(!off.includes('reportlog-media-worker.timer'));
  assert.ok(on.includes('reportlog-media-worker.timer'));
});

test('every unit the doctor expects is a file that actually ships', () => {
  // The drift this catches: adding a unit to contrib/systemd and forgetting
  // to check it, or checking for one that was renamed. Either leaves the
  // doctor confidently wrong about a deployment.
  const dir = new URL('../contrib/systemd/', import.meta.url);
  const shipped = new Set(fs.readdirSync(dir));
  for (const u of EXPECTED_UNITS) {
    assert.ok(shipped.has(u.unit), `${u.unit} is expected but not shipped`);
    assert.ok(u.missing && u.missing.length > 20, `${u.unit} does not say what goes wrong`);
  }
  // And the other way: every timer that ships is one the doctor knows about.
  const known = new Set(EXPECTED_UNITS.map((u) => u.unit));
  for (const f of shipped) {
    if (f.endsWith('.timer')) {
      assert.ok(known.has(f), `${f} ships but nothing checks whether it is enabled`);
    }
  }
});

test('the digest timers are required once somebody has subscribed, and not before', () => {
  // The failure being closed: src/digest.js, its routes and its settings
  // pane shipped with no timer for either script, so people subscribed and
  // nothing was ever sent. Faulting an archive nobody follows would be
  // noise; faulting one where somebody chose a digest in their own settings
  // is a promise not kept.
  const none = missingUnits(new Set(), { subscribers: 0 }).required.map((u) => u.unit);
  const some = missingUnits(new Set(), { subscribers: 1 }).required.map((u) => u.unit);
  assert.ok(!none.includes('reportlog-notify-hourly.timer'));
  assert.ok(!none.includes('reportlog-notify-weekly.timer'));
  assert.ok(some.includes('reportlog-notify-hourly.timer'));
  assert.ok(some.includes('reportlog-notify-weekly.timer'));
  // Still reported either way, so an operator can see they exist.
  assert.ok(missingUnits(new Set(), {}).all.map((u) => u.unit)
    .includes('reportlog-notify-hourly.timer'));
});

test('the anchor watch is always required, like the anchor itself', () => {
  for (const subscribers of [0, 5]) {
    for (const attachments of [false, true]) {
      const names = missingUnits(new Set(), { subscribers, attachments })
        .required.map((u) => u.unit);
      assert.ok(names.includes('reportlog-anchor-watch.timer'),
        'nothing noticing the anchor stopped is never acceptable');
    }
  }
});

test('anchor freshness: ok, stale, and never are three different answers', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  // A date column carries no time, so age is measured from midnight of the
  // anchor's day. Today's anchor therefore reads as 12h rather than 0.
  assert.equal(anchorHealth('2026-10-03', { now }).state, 'ok');
  assert.equal(anchorHealth('2026-10-02', { now }).state, 'ok', 'yesterday is the ordinary case');
  assert.equal(anchorHealth('2026-10-01', { now }).state, 'stale', 'a whole run was skipped');
  assert.equal(anchorHealth(null, { now }).state, 'never');
  assert.equal(anchorHealth(undefined, { now }).state, 'never');
  assert.equal(anchorHealth('', { now }).state, 'never');
  // Junk must not read as healthy. A column that somehow holds nonsense is
  // a reason to shout, not to say fine.
  assert.equal(anchorHealth('not a date', { now }).state, 'never');
  // A Date object as well as a string, because pg hands back either
  // depending on the driver's parsing settings.
  assert.equal(anchorHealth(new Date('2026-10-03T04:00:00Z'), { now }).state, 'ok');
  assert.equal(anchorHealth(new Date('2026-09-20T04:00:00Z'), { now }).state, 'stale');
});

test('the anchor goes stale after one missed run, not two', () => {
  // 36 hours, not 48: the job is daily, so 48 means the archive is two days
  // stale in public before anybody is told. Asserted because the number is
  // the whole sensitivity of the alarm and a later tweak should be a
  // decision rather than a drive-by.
  assert.equal(ANCHOR_MAX_AGE_HOURS, 36);
  assert.ok(ANCHOR_MAX_AGE_HOURS > 24, 'a daily job is ~24h apart from itself at best');
  assert.ok(ANCHOR_MAX_AGE_HOURS < 48, 'two days late is too late to call it daily');
});

test('anchor freshness never understates the age', () => {
  // The midnight rounding can only make the archive look staler than it is,
  // which is the safe direction for an alarm. Asserted so a later "fix" to
  // the rounding cannot quietly invert it.
  const now = new Date('2026-10-03T23:59:00Z');
  assert.ok(anchorHealth('2026-10-03', { now }).ageHours >= 23);
  assert.ok(anchorHealth(new Date('2026-10-03T23:00:00Z'), { now }).ageHours <= 1);
});

test('an empty archive that has never anchored is not a fault; one with reports is', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  const never = anchorHealth(null, { now });
  assert.equal(anchorFault(never, { hasReports: false }), null,
    'a deployment set up this morning is not broken');
  assert.ok(anchorFault(never, { hasReports: true }));
  assert.ok(anchorFault(never, { hasReports: true }).includes('NOTHING HAS EVER BEEN ANCHORED'));
  // Stale is a fault whether or not there are reports: the table has rows,
  // so this archive was anchoring and has stopped.
  const stale = anchorHealth('2026-09-20', { now });
  assert.ok(anchorFault(stale, { hasReports: false }));
  assert.equal(anchorFault(anchorHealth('2026-10-03', { now })), null);
});

test('the anchor fault names the date and the age, so the mail is actionable', () => {
  const fault = anchorFault(anchorHealth('2026-09-20', { now: new Date('2026-10-03T12:00:00Z') }));
  assert.ok(fault.includes('2026-09-20'), 'says which anchor is the newest');
  assert.ok(/\d/.test(fault), 'says how long it has been');
});

test('a backup name round-trips, and sorts by age as text', () => {
  const t = new Date('2026-10-02T04:05:06Z');
  const name = backupName(t);
  assert.equal(name, 'reportlog-2026-10-02T04-05-06Z.dump');
  assert.equal(backupTime(name).toISOString(), t.toISOString());
  assert.equal(backupTime('notes.txt'), null);
  assert.ok(backupName(new Date('2026-10-01T00:00:00Z')) < name, 'text order is time order');
});

test('pruning only ever touches files this script wrote', () => {
  // A backup directory is somewhere a person also puts things by hand. A
  // retention job that deleted whatever it found would eventually take one.
  const mine = ['reportlog-2026-10-03T00-00-00Z.dump', 'reportlog-2026-10-02T00-00-00Z.dump',
    'reportlog-2026-10-01T00-00-00Z.dump'];
  const theirs = ['before-the-upgrade.dump', 'notes.txt', 'reportlog.dump'];
  const gone = prune([...mine, ...theirs], 2);
  assert.deepEqual(gone, ['reportlog-2026-10-01T00-00-00Z.dump']);
  for (const f of theirs) assert.ok(!gone.includes(f), `${f} would have been deleted`);
});

test('a retention setting of zero still keeps one backup', () => {
  // A typo that deleted the dump it had just taken would have no recovery.
  const names = [backupName(new Date('2026-10-02T00:00:00Z'))];
  assert.deepEqual(prune(names, 0), []);
  assert.deepEqual(prune(names, -5), []);
  assert.deepEqual(prune(names, Number.NaN).length, 0);
});

test('the restore command runs as the service user, the only one who can read the dumps', () => {
  // The guide's restore ran as postgres, against a dump in a directory only
  // the service user can enter, so it could not open the file. Measured on
  // 15 October with a real dump.
  const cmd = restoreCommand({ user: 'reportlog', repo: '/srv/reportlog', dir: '/var/backups/reportlog' });
  assert.match(cmd, /^sudo -u reportlog sh -c 'pg_restore --clean --if-exists/m);
  assert.match(cmd, /grep \^DATABASE_URL= \/srv\/reportlog\/\.env/);
  assert.match(cmd, /\/var\/backups\/reportlog\/<file>'/);
  assert.doesNotMatch(cmd, /-u postgres/);
  assert.ok(cmd.indexOf('systemctl stop') < cmd.indexOf('pg_restore'), 'restore under a running service');
  assert.ok(cmd.indexOf('systemctl start') > cmd.indexOf('pg_restore'));
});

test('backup health distinguishes never, stale and current', () => {
  const now = new Date('2026-10-05T00:00:00Z');
  assert.equal(backupHealth([], { now }).state, 'none');
  assert.equal(backupHealth(['notes.txt'], { now }).state, 'none');
  assert.equal(backupHealth([backupName(new Date('2026-10-01T00:00:00Z'))], { now }).state, 'stale');
  assert.equal(backupHealth([backupName(new Date('2026-10-04T18:00:00Z'))], { now }).state, 'ok');
  // The newest wins, not the count.
  const mixed = [backupName(new Date('2026-09-01T00:00:00Z')),
    backupName(new Date('2026-10-04T18:00:00Z'))];
  const h = backupHealth(mixed, { now });
  assert.equal(h.state, 'ok');
  assert.equal(h.count, 2);
});

test('a backup directory inside the checkout is refused', () => {
  // Under public/ nginx would serve the whole archive to anybody who guessed
  // the name. Anywhere in the checkout, git offers to commit it.
  assert.equal(checkDir('/srv/reportlog/backups', { root: '/srv/reportlog' }).reason, 'inside-checkout');
  assert.equal(checkDir('/srv/reportlog/public/b', { root: '/srv/reportlog' }).reason, 'inside-checkout');
  assert.equal(checkDir('/srv/reportlog', { root: '/srv/reportlog' }).reason, 'inside-checkout');
  assert.ok(checkDir('/var/backups/reportlog', { root: '/srv/reportlog' }).ok);
  assert.ok(checkDir('/srv/reportlog-backups', { root: '/srv/reportlog' }).ok,
    'a sibling that merely shares a prefix is fine');
});

test('backup settings fall back to the documented defaults', () => {
  const d = backupSettings({});
  assert.equal(d.keep, DEFAULT_KEEP);
  assert.equal(d.maxAgeHours, DEFAULT_MAX_AGE_HOURS);
  assert.equal(backupSettings({ BACKUP_KEEP: 'nonsense' }).keep, DEFAULT_KEEP);
  assert.equal(backupSettings({ BACKUP_KEEP: '3' }).keep, 3);
  assert.equal(backupSettings({ BACKUP_DIR: '/x' }).dir, '/x');
});

test('the backup script never copies .env, and says why', () => {
  // The keys beside the ciphertext they open would turn two secrets into one.
  const src = fs.readFileSync(new URL('./backup.js', import.meta.url), 'utf8');
  const code = stripComments(src);
  assert.ok(!/['"`][^'"`]*\.env['"`]/.test(code.replace(/--env-file[^\s'"]*/g, '')),
    'backup.js references .env as a file in code rather than only in prose');
  assert.match(src, /does not back up|NOT BACK UP/i);
});

test('the backup script writes a partial name and renames only after reading it back', () => {
  const src = stripComments(fs.readFileSync(new URL('./backup.js', import.meta.url), 'utf8'));
  assert.match(src, /\.partial/);
  assert.match(src, /pg_restore/);
  assert.ok(src.indexOf('pg_restore') < src.indexOf('renameSync'),
    'it must verify before it renames, or a truncated dump gets the real name');
  assert.match(src, /execFileSync\('pg_dump', \[/, 'an argument array, never a shell string');
});

test('the installers print before they act, and refuse a home-directory node', () => {
  const units = fs.readFileSync(new URL('../contrib/install-units.sh', import.meta.url), 'utf8');
  const inst = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
  for (const [name, src] of [['install-units.sh', units], ['install.sh', inst]]) {
    assert.match(src, /--dry-run/, `${name} has no dry run`);
    assert.match(src, /set -euo pipefail/, `${name} does not stop on an error`);
  }
  // systemd does not read a shell profile, so a version manager's node is a
  // unit that cannot start, with a message that names a missing file.
  assert.match(units, /\.nvm|\.fnm|\.asdf/);
  // The five lines the guide says to change together.
  for (const k of ['User=', 'Group=', 'WorkingDirectory', 'ExecStart', 'ReadWritePaths']) {
    assert.ok(units.includes(k), `install-units.sh does not substitute ${k}`);
  }
});


/* ---------------------------------------------------------------------- *
 * The two install guides, which are the same guide.
 *
 * INSTALL.md is what GitHub shows somebody handed a repository link.
 * public/docs.html is the same install, rendered, with copy buttons, and is
 * what a running deployment serves at /docs. Two full copies of one
 * procedure is exactly the arrangement this project distrusts — so the
 * checks below make them fail together rather than drift apart quietly.
 * ---------------------------------------------------------------------- */

const installMd = fs.readFileSync(new URL('../INSTALL.md', import.meta.url), 'utf8');
const docsHtml = readPublic('docs.html');
const readmeMd = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('all three guides, and install.sh, clone the same ref', () => {
  // The invariant is AGREEMENT. What is never right is a MIXTURE: two people
  // cloning from the same repository and getting different software. This
  // has gone wrong twice — the guides said v0.0.3 while install.sh cloned
  // main, and before that the guides outran the newest tag.
  const refsIn = (text) => new Set(
    [...text.matchAll(/--branch\s+([A-Za-z0-9._\/-]+)/g)].map((m) => m[1]),
  );
  const md = refsIn(installMd);
  const html = refsIn(docsHtml);
  const readme = refsIn(readmeMd);

  assert.equal(md.size, 1, `INSTALL.md names ${md.size} refs to clone: ${[...md]}`);
  const ref = [...md][0];
  assert.deepEqual([...html].sort(), [...md].sort(),
    'docs.html and INSTALL.md disagree about what to clone');
  assert.deepEqual([...readme].sort(), [...md].sort(),
    'README.md and INSTALL.md disagree about what to clone');

  const sh = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
  const shRef = sh.match(/^REF=(\S+)/m);
  assert.ok(shRef, 'install.sh no longer pins a ref');
  assert.equal(shRef[1], ref, `install.sh clones ${shRef[1]} and the guides say ${ref}`);
  assert.match(sh, /git clone --branch '\$REF'/,
    'install.sh pins a ref and then clones without it');

  for (const [what, text] of [['INSTALL.md', installMd], ['docs.html', docsHtml],
    ['README.md', readmeMd]]) {
    assert.match(text, /git clone[^\n<]*reportlog\.git/,
      `${what} does not tell anybody how to get the code`);
  }

  // Installing from main is a decision, so it has to be a stated one —
  // otherwise it reads as somebody having dropped the release ref.
  if (ref === 'main') {
    for (const [what, text] of [['INSTALL.md', installMd], ['docs.html', docsHtml]]) {
      assert.match(text, /clones <code>main<\/code>, deliberately|clones `main`, deliberately/,
        `${what} clones main without saying why`);
    }
  }
});

test('the guides install from a branch, because a tag breaks the upgrade', () => {
  // MEASURED 7 OCTOBER 2026 against a real clone of v0.0.3, not reasoned
  // about: `git clone --branch <tag>` leaves a DETACHED HEAD, so
  // `git rev-parse --abbrev-ref HEAD` — which is how contrib/deploy.sh
  // decides what to pull — returns the literal string `HEAD`, and
  // `git pull --ff-only origin HEAD` takes the remote's DEFAULT BRANCH.
  // A box installed from a tag upgrades itself onto main, silently, the
  // first time anybody runs the upgrade.
  //
  // So the ref in the guides must not look like a version tag. This is the
  // guard that stops somebody "tidying" it back to a tag for the
  // reproducibility argument, which is real but costs more than it buys.
  const ref = [...installMd.matchAll(/--branch\s+([A-Za-z0-9._\/-]+)/g)].map((m) => m[1])[0];
  assert.ok(ref, 'INSTALL.md has no clone ref at all');
  assert.doesNotMatch(ref, /^v\d+\.\d+/,
    `the guides install from the tag ${ref}; a tag clone is detached and `
    + 'deploy.sh would pull the default branch instead');

  // deploy.sh must still be the thing that reads the branch, or the reason
  // above has quietly stopped applying.
  const deploy = fs.readFileSync(new URL('../contrib/deploy.sh', import.meta.url), 'utf8');
  assert.match(deploy, /rev-parse --abbrev-ref HEAD/,
    'deploy.sh no longer derives the branch; re-check whether a tag is safe now');

  // And both guides have to say why, so the next person does not undo it.
  for (const [what, text] of [['INSTALL.md', installMd], ['docs.html', docsHtml]]) {
    assert.match(text, /detached HEAD|detached <b>HEAD<\/b>|<b>detached HEAD<\/b>/i,
      `${what} does not explain why this is a branch rather than a tag`);
  }
});

test('the version the site reports is the version in package.json', () => {
  // Three things that have to be one thing: package.json, the string the
  // deployment shows on its own lock screen and under /api/v1, and the chip
  // on the rendered guide. They were not: package.json said 0.0.2 and the
  // site said v0.0.02, because the patch was padded to two digits.
  const pkgVersion = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ).version;
  assert.equal(RELEASE_VERSION, `v${pkgVersion}`,
    'the reported release is not just v plus the version in package.json');
  assert.doesNotMatch(RELEASE_VERSION, /\.0\d/,
    `${RELEASE_VERSION} has a padded component, which no tag is ever named with`);
});

test('the guide badges the version it describes, not the branch it clones', () => {
  // The chip used to be tied to the clone target, which only worked while
  // that was a tag. The ref is now a branch and says nothing about version,
  // so the chip tracks what the software calls itself instead — and must
  // move when package.json does.
  const badge = /<span class="chip">([^<]+)<\/span>/.exec(docsHtml);
  assert.ok(badge, 'docs.html has no version chip');
  assert.equal(badge[1].trim(), RELEASE_VERSION,
    `the chip says ${badge[1].trim()} and the software reports ${RELEASE_VERSION}`);

  // The footer makes the same claim in prose and drifts the same way.
  const footer = /ReportLog (v[0-9][^\s]*)\s*·/.exec(docsHtml);
  assert.ok(footer, 'docs.html footer no longer names a version');
  assert.equal(footer[1], RELEASE_VERSION,
    `the footer says ${footer[1]} and the software reports ${RELEASE_VERSION}`);
});

test('the rendered guide lists exactly the units that ship', () => {
  // THE CHECK THAT WAS MISSING, and the drift it failed to catch: four units
  // were added on 3 October, INSTALL.md was updated and docs.html was not, so
  // the page told an operator to expect five timers where there are seven.
  // The suite was 568 green with the page wrong, because every other check
  // compares commands and prose rather than this table.
  const shipped = fs.readdirSync(new URL('../contrib/systemd/', import.meta.url))
    .filter((f) => f.endsWith('.timer'))
    .map((f) => f.replace(/^reportlog-?/, '').replace(/\.timer$/, ''));
  for (const unit of shipped) {
    assert.ok(docsHtml.includes(`<th>${unit}</th>`),
      `docs.html has no row for the ${unit} timer`);
  }
  // And the count the prose claims has to match.
  const words = { 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine' };
  const claimed = words[shipped.length];
  assert.ok(claimed, `${shipped.length} timers is more than this check can spell`);
  assert.match(docsHtml, new RegExp(`<b>${claimed}</b> timers|${claimed} timers`, 'i'),
    `docs.html has ${shipped.length} timers and does not say so`);
  assert.match(installMd, new RegExp(`${claimed} timers`, 'i'),
    `INSTALL.md has ${shipped.length} timers and does not say so`);
  // Both guides must name every timer, so a new one cannot ship unmentioned.
  for (const unit of shipped) {
    assert.ok(installMd.includes(unit), `INSTALL.md never mentions the ${unit} timer`);
  }
});

test('both guides state the same system requirements', () => {
  // A sizing figure is exactly the sort of thing that gets updated in one
  // guide and not the other, and a reader sizing a box from the stale one
  // buys the wrong machine. These are the figures that came from measuring,
  // so they are the ones worth pinning together.
  const required = [
    '22.0.0',          // the Node floor the app actually enforces
    '16 or 17',        // PostgreSQL
    'Debian 12',
    '75 MB',           // the app resident
    '10 MB',           // a freshly migrated database
    '2 GB',            // the media cache default
    '21.8',            // the measured transcode, 30s of 1080p on one core
  ];
  for (const fact of required) {
    assert.ok(installMd.includes(fact),
      `INSTALL.md no longer states the measured figure "${fact}"`);
    assert.ok(docsHtml.includes(fact),
      `public/docs.html no longer states the measured figure "${fact}"`);
  }

  // The Node floor must match what the code enforces, not just match itself.
  const engines = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).engines;
  if (engines && engines.node) {
    const major = engines.node.match(/(\d+)/);
    assert.ok(installMd.includes(`${major[1]}.0.0`) || installMd.includes(`Node ${major[1]}`),
      `package.json requires node ${engines.node} and INSTALL.md does not say so`);
  }

  // And neither guide may go back to hand-waving the size of the box.
  for (const [what, text] of [['INSTALL.md', installMd], ['docs.html', docsHtml]]) {
    assert.ok(!/smallest tier most hosts sell/.test(text),
      `${what} still waves at "the smallest tier most hosts sell" instead of a number`);
  }
});

test('every section link in INSTALL.md points at a heading that exists', () => {
  // THE GUIDE IS ALL CROSS-REFERENCES. Its contents list, the four warnings
  // in §1 and the new §0 all link by anchor, and a renamed or renumbered
  // heading breaks them silently — markdown has no broken-link error, it
  // just does nothing when you click. Written when §0 was added, which moved
  // nothing but could have.
  //
  // GitHub's own slug: lowercase, drop everything that is not a letter,
  // digit, hyphen, underscore or space, then spaces to hyphens. That is why
  // "3.1 · A user" becomes "31--a-user" — the dot and the middot vanish and
  // their spaces do not.
  const slug = (heading) => heading.toLowerCase()
    .replace(/[^\w\- ]/g, '')
    .replace(/ /g, '-');

  const headings = new Set();
  for (const [, hashes, titleRaw] of installMd.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
    void hashes;
    // Inline code and emphasis are not part of the slug GitHub generates.
    headings.add(slug(titleRaw.trim().replace(/[`*]/g, '')));
  }

  const links = [...installMd.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length > 20, `only ${links.length} section links found`);
  const broken = [...new Set(links.filter((a) => !headings.has(a)))];
  assert.deepEqual(broken, [],
    `INSTALL.md links to anchors that no heading produces: ${broken.join(', ')}`);
});

test('both guides start where a new server starts, not at a root shell', () => {
  // For three weeks both guides opened at "any Linux box you have root on"
  // and said nothing about how to get root on it. The reader this is written
  // for had just rented a server and was looking at a control panel. The
  // rendered guide grew a Part 0 on 7 October; this is what stops the
  // markdown one from being trimmed back to where it was, or from gaining
  // the coverage in only one of the two files again.
  for (const [what, raw] of [['INSTALL.md', installMd], ['docs.html', docsHtml]]) {
    const text = raw.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
      .replace(/[*`>]/g, ' ').replace(/\s+/g, ' ');
    for (const [name, needle] of [
      ['how to make an SSH key', 'ssh-keygen -t ed25519'],
      ['which half of the key is shared', '.pub'],
      ['how to open a terminal on Windows', 'powershell'],
      ['the actual connect command', 'ssh root@'],
      ['the host-key warning you get once', 'authenticity of the host'],
      ['that a password echoes nothing', 'not even dots'],
      ['updating a fresh image', 'apt update'],
      ['the firewall, SSH rule first', 'ufw allow OpenSSH'],
      ['keeping a second session open', 'second'],
    ]) {
      assert.ok(text.toLowerCase().includes(needle.toLowerCase()),
        `${what} does not cover ${name}`);
    }
    // The firewall is the one that locks people out of their own server, so
    // the SSH rule has to come before the enable in the text, not after.
    const sshRule = text.indexOf('ufw allow OpenSSH');
    const enable = text.indexOf('ufw --force enable');
    assert.ok(sshRule >= 0 && enable > sshRule,
      `${what} enables the firewall before allowing SSH`);
  }
});

test('both guides name every way the code can send mail', () => {
  // src/email.js has had a second transport for weeks and NEITHER guide said
  // so: docs.html never used the word Scaleway outside a storage table, and
  // INSTALL.md mentioned "a Scaleway key" without naming a variable. A
  // supported path nothing documents is a path nobody uses, and the one
  // person who tries it has to read the source to find the two names.
  const email = fs.readFileSync(new URL('../src/email.js', import.meta.url), 'utf8');
  const chosen = [...email.matchAll(/forced === '([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(chosen.sort(), ['log', 'scaleway', 'smtp'], 'the transports changed');

  // `log` is the one that sends nothing, so it is deliberately not something
  // an install guide walks somebody into. Every transport that DOES send
  // mail has to be reachable from the guides.
  for (const [what, text] of [['INSTALL.md', installMd], ['docs.html', docsHtml]]) {
    assert.match(text, /SMTP_HOST|SMTP credentials/,
      `${what} does not document the SMTP transport`);
    for (const v of ['SCALEWAY_SECRET_KEY', 'SCALEWAY_PROJECT_ID']) {
      assert.ok(text.includes(v),
        `${what} does not name ${v}, which is half of the Scaleway transport`);
    }
  }

  // And the variables the guides name must be the ones the readiness check
  // actually asks for, rather than names that were right once.
  for (const v of ['SCALEWAY_SECRET_KEY', 'SCALEWAY_PROJECT_ID']) {
    assert.ok(email.includes(`'${v}'`), `email.js no longer reads ${v}`);
  }
});

test('both guides carry the prerequisites a first-timer cannot guess', () => {
  // These drifted for three weeks: docs.html grew a DNS walkthrough, a mail
  // provider table and a bucket table, and INSTALL.md — the canonical guide,
  // and the one GitHub shows — still had five lines about an A record. Each
  // item below cost somebody an hour and is invisible until it bites.
  for (const [what, raw] of [['INSTALL.md', installMd], ['docs.html', docsHtml]]) {
    const text = raw.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
      .replace(/[*`>]/g, ' ').replace(/\s+/g, ' ');
    for (const [name, needle] of [
      ['which DNS panel is the live one', 'dig +short NS'],
      ['the Cloudflare proxy breaking certbot', 'DNS only'],
      ['SPF and DKIM, without which mail is spam', 'DKIM'],
      ['port 25 being blocked outbound', 'Port 25 is blocked'],
      ['that the evidence bucket is never public', 'Never'],
      ['the staging bucket by name', 'reportlog-staging'],
    ]) {
      assert.ok(text.includes(needle), `${what} does not cover ${name}`);
    }
  }
});

test('both guides say a fresh deployment can take no reports yet', () => {
  // THE CLIFF AT THE END OF THE INSTALL. Both guides used to stop at the
  // setup wizard, and a deployment that finishes the wizard accepts nothing:
  // every report is filed through a logbook and a fresh archive has none. An
  // operator who followed the guide to the last step had a working site that
  // could not be used, with nothing telling them why.
  //
  // Each phrase below is a rule from CLAUDE.md that an operator has to know
  // BEFORE they launch, because launching is the one-way door.
  for (const [what, raw] of [['INSTALL.md', installMd], ['docs.html', docsHtml]]) {
    const text = raw.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ')
      .replace(/[*`>]/g, ' ').replace(/\s+/g, ' ');
    for (const [name, needle] of [
      ['that nothing can be filed without a logbook', 'no logbook accepts no reports'],
      ['that launching cannot be undone', 'irreversible'],
      ['the one thing a launched logbook may still gain', 'new optional question'],
      ['that the slug is sealed and never editable', 'never be changed'],
      ['that uploads are decided by asking for them', 'the question is the switch'],
      ['that nothing publishes itself', 'no auto-publish path'],
      ['that the owner seat cannot be granted', 'cannot be granted at all'],
      ['walking a confirmation link by hand', 'confirmation link'],
    ]) {
      assert.ok(text.includes(needle), `${what} does not say ${name}`);
    }
  }

  // The one-way door is enforced by assertDraft, so if that guard ever moves
  // out of the module the guides are describing something that is no longer
  // true at every path.
  const logbooks = fs.readFileSync(new URL('../src/logbooks.js', import.meta.url), 'utf8');
  assert.match(logbooks, /function assertDraft/,
    'assertDraft is gone; the guides still promise a launched form is frozen');

  // And the starting points the guides list have to be the ones that ship.
  const templates = fs.readFileSync(new URL('../src/templates.js', import.meta.url), 'utf8');
  const declared = templates.match(/LOGBOOK_STARTING_POINTS = \[([^\]]+)\]/);
  assert.ok(declared, 'templates.js no longer declares its starting points');
  const ids = [...declared[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  for (const id of ids) {
    const file = JSON.parse(fs.readFileSync(
      new URL(`../templates/${id}.json`, import.meta.url), 'utf8'));
    for (const [what, text] of [['INSTALL.md', installMd], ['docs.html', docsHtml]]) {
      assert.ok(text.includes(file.title),
        `${what} does not list the starting point "${file.title}"`);
    }
  }
});

test('no guide installs the units by hand: every install goes through install-units.sh', () => {
  // MENTIONING A TIMER IS NOT ENABLING IT. There were two by-hand copies of
  // the unit install, in §1 and §3.13, and they drifted from the script one
  // omission at a time: the anchor timer, then the backup timer, then the
  // backup directory, the sudoers line and the transparency log's directory.
  // They are gone, on purpose — `install-units.sh --dry-run` prints the
  // by-hand version, always current. This keeps them gone.
  for (const [name, text] of [
    ['INSTALL.md', installMd],
    ['contrib/README.md', fs.readFileSync(new URL('../contrib/README.md', import.meta.url), 'utf8')]]) {
    const blocks = text.split('```').filter((_, i) => i % 2 === 1);
    assert.ok(!blocks.some((b) => /systemctl enable --now reportlog/.test(b)),
      `${name} enables units by hand again; that list drifts — point at install-units.sh`);
    assert.ok(!blocks.some((b) => /cp contrib\/systemd\/reportlog/.test(b)),
      `${name} copies unit files by hand again`);
  }
  const blocks = installMd.split('```').filter((_, i) => i % 2 === 1);
  assert.ok(blocks.filter((b) => /contrib\/install-units\.sh/.test(b)).length >= 2,
    'the short version and §3.13 should both run install-units.sh');

  // And the script itself enables every timer that ships, by glob, so a new
  // timer cannot be left out of it the way it was left out of the lists.
  const units = fs.readFileSync(new URL('../contrib/install-units.sh', import.meta.url), 'utf8');
  assert.match(units, /for t in "\$TMP"\/reportlog-\*\.timer; do/);
  assert.match(units, /install -m 755 -o root -g root '\$TMP\/update-apply\.sh'/);
  assert.match(units, /install -d -m 700 -o '\$USER_NAME' -g '\$USER_NAME' '\$BACKUP_DIR'/);
});

test('every npm script the guides tell somebody to run exists', () => {
  // `npm run export-archive` was in §5 and in no package.json, so the one
  // command in the backups section that moves an archive across a schema
  // change failed with "missing script" for anybody who tried it. The script
  // was there all along as scripts/export-archive.js; nothing wired it up.
  const pkg = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const have = new Set(Object.keys(pkg.scripts));

  for (const [what, text] of [['INSTALL.md', installMd], ['docs.html', docsHtml]]) {
    const named = new Set((text.match(/npm run [a-z][a-z:-]*/g) || [])
      .map((m) => m.slice('npm run '.length)));
    for (const target of named) {
      assert.ok(have.has(target),
        `${what} says "npm run ${target}" and package.json has no such script`);
    }
  }
});


test('the rendered guide carries every command the markdown one does', () => {
  // Not a diff of the two files, which would fail on prose. The commands are
  // what somebody types, and a step present in one guide and missing from the
  // other is a step somebody skips.
  const required = [
    'npm ci --omit=dev',
    'npm run doctor',
    'npm run configure',
    'npm run migrate',
    'npm run set-curtain-password',
    'npm run mail-test',
    'npm run backup',
    'contrib/install-units.sh',
    'contrib/deploy.sh',
    'contrib/reset-to-fresh.sh',
    'install.sh --dry-run',
    'certbot --nginx',
    'nginx -t',
    'csp.conf',
    'systemctl list-timers',
    '/api/health',
  ];
  for (const cmd of required) {
    assert.ok(installMd.includes(cmd), `INSTALL.md has lost: ${cmd}`);
    assert.ok(docsHtml.includes(cmd), `public/docs.html has lost: ${cmd}`);
  }
});

test('both guides warn about the four things that bite, in both places', () => {
  // Each of these cost somebody real time, and each is the kind of warning
  // that gets trimmed by whoever is shortening a page.
  for (const [name, pattern] of [
    ['the irreplaceable keys', /irreplaceable|unreadable (forever|<b>forever)/i],
    ['mail not being optional', /nobody can sign in/i],
    ['the curtain with no password', /nothing matches it/i],
    ['the manifest failing with a 200', /200/],
  ]) {
    assert.match(installMd, pattern, `INSTALL.md no longer warns about ${name}`);
    assert.match(docsHtml, pattern, `docs.html no longer warns about ${name}`);
  }
});

test('the rendered guide names every path the doctor actually checks', () => {
  // The guide tells an operator the proxy must forward five paths and the
  // doctor checks five paths. Adding a sixth to one and not the other leaves
  // either a guide that under-reports or a check nobody was told about.
  for (const p of PROXIED_PATHS) {
    assert.ok(docsHtml.includes(p.path), `docs.html does not mention ${p.path}`);
    assert.ok(installMd.includes(p.path), `INSTALL.md does not mention ${p.path}`);
  }
  // And the count the prose claims has to match the list.
  const claimed = /\bfive paths\b/i.test(docsHtml);
  assert.equal(claimed, PROXIED_PATHS.length === 5,
    `the guides say "five paths" but the doctor checks ${PROXIED_PATHS.length}`);
});

test('the rendered guide works with JavaScript off', () => {
  // Somebody standing up a server reads this in whatever browser the box
  // has. The copy buttons, the fill-in-once panel and the ticks are all
  // built by the script; the commands themselves must be in the markup.
  const script = readPublic('js/docs-page.js');
  // Every command block has its text in the page, not in a data attribute
  // the script expands.
  const blocks = [...docsHtml.matchAll(/<div class="cmd"><pre><code>([\s\S]*?)<\/code><\/pre>/g)];
  assert.ok(blocks.length >= 15, `only ${blocks.length} command blocks found`);
  for (const [, body] of blocks) {
    assert.ok(body.trim().length, 'a command block is empty without the script');
  }
  // The panel is an enhancement: the page must not depend on it existing.
  assert.match(script, /if \(panel\) buildPanel\(panel\)/);
  // And the defaults the substitution replaces have to be real values a
  // reader could paste as-is.
  for (const d of ['reports.example.org', '/srv/reportlog', 'reportlog', 'you@example.org']) {
    assert.ok(docsHtml.includes(d), `the guide's blocks do not carry the default ${d}`);
  }
});

test('the number of steps the guide claims is the number it has', () => {
  // Written after claiming eleven and shipping twelve. The count is in two
  // places in the prose and the steps are in the markup, so nothing made
  // them agree.
  const steps = [...docsHtml.matchAll(/<li data-step="/g)].length;
  const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
  const claimed = words[steps - 1];
  assert.ok(claimed, `${steps} steps is more than this check knows how to spell`);
  const saidWrong = words.filter((w) => w !== claimed
    && new RegExp(`\\b${w} steps\\b`, 'i').test(docsHtml));
  assert.deepEqual(saidWrong, [],
    `the guide has ${steps} steps but its prose says ${saidWrong.join(' and ')}`);
  assert.match(docsHtml, new RegExp(`\\b${claimed} steps\\b`, 'i'),
    `the guide has ${steps} steps and never says so`);
  // Each one needs a stable key, or a tick moves to a different step when
  // one is inserted.
  const keys = [...docsHtml.matchAll(/<li data-step="([a-z]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(keys).size, keys.length, 'two steps share a data-step key');
});

test('the guide substitutes the longest placeholder first', () => {
  // /srv/reportlog contains reportlog. Replacing the shorter one first turns
  // the path into nonsense, and the reader pastes it.
  const script = readPublic('js/docs-page.js');
  assert.match(script, /sort\(\(a, b\) => b\.from\.length - a\.from\.length\)/);
  // And it must substitute from the ORIGINAL each pass, not from the last
  // result, or a second keystroke compounds the first.
  assert.match(script, /dataset\.original/);
});

group('The evidence declaration');

test('it seals the same boolean a yes/no does, through the same call', () => {
  // The reason the type is safe to add at all: a report answering it hashes
  // exactly as one answering a yes/no does, so nothing already filed
  // rehashes. A second normalizer for one shape is how the two come to
  // disagree, so it is the SAME call and not a copy of it.
  const src = fs.readFileSync(new URL('../src/answers.js', import.meta.url), 'utf8');
  assert.match(src, /case 'evidence_declaration': return normalizeYesNo\(value\)/,
    'the declaration normalizes through code of its own, which can drift from yes/no');
});

test('it is in the catalogue, conditionable, and offers yes and no', async () => {
  const { FIELD_TYPES, EVIDENCE_DECLARATION_TYPE, canFilter } = await import('../src/fieldTypes.js');
  const { CONDITIONABLE_KINDS, CANNOT_CARRY_CONDITION, matchableValues } = await import('../src/conditions.js');
  assert.equal(EVIDENCE_DECLARATION_TYPE, 'evidence_declaration');
  const t = FIELD_TYPES.find((f) => f.id === 'evidence_declaration');
  assert.ok(t, 'the type is not in the catalogue, so no operator can add it');
  // Its wording has to say that nothing is uploaded, or an operator will
  // reach for the upload question instead and the whole pattern is unused.
  assert.match(t.description, /without asking for them/);

  // The pattern IS a condition: the "what is it of?" follow-up is asked
  // only when somebody said they had something.
  assert.ok(CONDITIONABLE_KINDS.has('evidence_declaration'),
    'the follow-up card could never be conditional on it');
  assert.ok(!CANNOT_CARRY_CONDITION.has('evidence_declaration'),
    'unlike the upload question, this one is an ordinary field');
  assert.deepEqual(matchableValues({ kind: 'evidence_declaration' }), ['yes', 'no'],
    'with no values to tick, every condition on it would be refused');
  assert.ok(canFilter('evidence_declaration'));
});

test('the declaration and the permission are two different things', async () => {
  // The rule 037 exists to protect. One checkbox meaning both would put a
  // revocable value inside the fingerprint, and a report would verify
  // differently because somebody changed their mind about being contacted.
  const { PERMISSIONS, EVIDENCE_REQUEST } = await import('../src/reportPermissions.js');
  assert.ok(PERMISSIONS.includes(EVIDENCE_REQUEST));

  // The declaration is a field, so it is sealed. The permission is not a
  // field, so nothing can seal it.
  const { FIELD_TYPES } = await import('../src/fieldTypes.js');
  assert.ok(!FIELD_TYPES.some((f) => f.id === 'evidence_request'),
    'the permission became a question, which would seal a revocable value');

  // And reportCore may not even see the log. npm test already asserts this
  // for the module; stated again here because this is the item that would
  // have broken it.
  const core = fs.readFileSync(new URL('../src/reportCore.js', import.meta.url), 'utf8');
  assert.doesNotMatch(core, /reportPermissions|evidence\.js/);
});

test('what was declared is read from the seal, and the permission now', async () => {
  const E = await import('../src/evidence.js');
  const fields = [
    { key: 'has_evidence', kind: 'evidence_declaration', label: 'Do you have any?' },
    { key: 'of', kind: 'short_text', label: 'What is it of?', shown_when: { field: 'has_evidence', in: ['yes'] } },
    { key: 'account', kind: 'long_text', label: 'What happened?' },
  ];
  assert.equal(E.declaredEvidence({ has_evidence: true }, fields), true);
  assert.equal(E.declaredEvidence({ has_evidence: false }, fields), false);
  // THE ABSENT-KEY RULE. An unanswered declaration has no key at all, and
  // "not yes" is the only safe reading for deciding there is nothing to ask
  // for.
  assert.equal(E.declaredEvidence({ account: 'x' }, fields), false);
  assert.equal(E.declaredEvidence(null, fields), false);

  // More than one declaration is allowed: nothing stops an operator asking
  // separately about photographs and documents, and reading only the first
  // would lose the second.
  const two = [...fields,
    { key: 'has_docs', kind: 'evidence_declaration', label: 'Any documents?' }];
  assert.deepEqual(E.declarationKeys(two), ['has_evidence', 'has_docs']);
  assert.equal(E.declaredEvidence({ has_docs: true }, two), true);

  // The follow-up is found by its CONDITION, not by a naming rule — a
  // naming rule would be a second, invisible schema.
  assert.deepEqual(E.describedEvidence({ has_evidence: true, of: '30s of the queue', account: 'long' }, fields),
    [{ label: 'What is it of?', value: '30s of the queue' }]);
  assert.deepEqual(E.describedEvidence({ account: 'not conditional on it' }, fields), []);
});

test('one predicate decides which questions seal a boolean, for all of them', () => {
  // Three controls draw a yes/no: the correction editor's select, the
  // board's filter and the form's own tiles. Three `||` chains is three
  // places for the second kind to be forgotten in, and the forgotten one
  // shows an operator a filter that silently matches nothing.
  const answers = readPublic('js/answers.js');
  assert.match(answers, /function isBoolKind\(kind\)/);
  assert.match(answers, /evidence_declaration/);
  for (const f of ['js/answers.js', 'js/board.js', 'js/form-logbook.js']) {
    // The predicate's OWN definition names both kinds, so it comes out
    // before counting what is left testing a kind by hand.
    const src = readPublic(f).replace(/function isBoolKind\(kind\)\{[\s\S]*?\n\}/, '');
    assert.match(src, /isBoolKind\(/, `${f} still tests the kind by hand`);
    const stray = [...src.matchAll(/kind\s*===\s*'yes_no'/g)];
    // form-logbook.js keeps ONE on purpose: the declaration draws its own
    // tiles, because "Yes" alone on a card asking whether somebody has
    // footage reads as agreeing to send it.
    assert.equal(stray.length, f === 'js/form-logbook.js' ? 1 : 0,
      `${f} has ${stray.length} hand-rolled yes_no checks left`);
  }
});

test('the elections template ships the pattern, as two cards', async () => {
  // So an operator meets a worked example rather than having to invent the
  // pairing. One card asks one question, which is why it is two.
  const { templateLogbook } = await import('../src/templates.js');
  const lb = templateLogbook('elections');
  const d = lb.questions.find((q) => q.kind === 'evidence_declaration');
  assert.ok(d, 'the elections logbook asks no declaration');
  assert.ok(!d.required, 'a declaration must not be compulsory');
  assert.match(d.help, /Nothing is uploaded/,
    'the card does not say that answering uploads nothing');

  const follow = lb.questions.find((q) => q.shown_when && q.shown_when.field === d.key);
  assert.ok(follow, 'nothing asks what the evidence is of');
  assert.equal(follow.kind, 'short_text',
    'one short line, escaped, no formatting — same reasoning as the editorial note');
  assert.deepEqual(follow.shown_when.in, ['yes']);
  assert.ok(!follow.required,
    'a question asked only sometimes cannot be required for everybody');

  // And the follow-up comes AFTER the thing it depends on, or the server
  // refuses it as a forward reference.
  const keys = lb.questions.map((q) => q.key);
  assert.ok(keys.indexOf(d.key) < keys.indexOf(follow.key));
});

test('the reporter can give and take back the permission', () => {
  // A permission nobody can grant is a permission nobody can act on, and
  // one that cannot be taken back is not revocable whatever the log says.
  const board = readPublic('js/board.js');
  const fn = board.slice(board.indexOf('function permissionsHtml'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /evidence_request/, 'the third grant is not offered anywhere');
  // Said as an invitation to be asked, not as a promise to send anything.
  const flat = body.replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' ');
  assert.match(flat, /Nothing is uploaded now/);
  assert.match(flat, /switching this off stops them asking/);
});

group('The filing form\'s card list');

test('nothing on a step is a mechanism unless something reads it', () => {
  // A STEPS entry carried `take: [...selectors]`, documented as "selectors
  // whose fields move onto this card" — and NOTHING HAS EVER READ IT. The
  // cards are static markup keyed by data-card and the fields are already
  // inside the right ones.
  //
  // The cost was not a wasted property. It made moving a field between
  // cards look like a one-line edit in the step list, when it is a change
  // to the markup — and the next thing anybody has to do to this form is
  // exactly that (the email card moves before the upload card).
  const form = readPublic('js/form.js');
  assert.ok(!/\btake:/.test(form), 'the property that looked executable is back');
  assert.match(form, /holds:/, 'the information about what is on each card was dropped');
  assert.match(form, /A COMMENT, NOT A MECHANISM/,
    'nothing warns the next reader that this list decides nothing');

  // And if anything ever DOES start reading it, this test is what has to
  // change — deliberately, rather than by the name quietly meaning
  // something again.
  for (const f of ['js/form.js', 'js/form-logbook.js', 'js/nav.js']) {
    const src = readPublic(f);
    assert.ok(!/\.holds\b/.test(src), `${f} reads holds, so it is a mechanism now`);
  }
});

test('what each card holds is what the markup actually has on it', () => {
  // The point of keeping the list: it is only worth having while it is
  // true, and nothing enforced that before.
  const form = readPublic('js/form.js');
  const page = readPublic('index.html');
  // Split on the step boundary rather than matching across it: a step body
  // is full of `}` from its own callbacks, so a [^}] run stops at the first
  // one and finds only the step that happens to declare holds first.
  const holds = form.split("{id:'").slice(1).map((chunk) => {
    const id = chunk.slice(0, chunk.indexOf("'"));
    const m = chunk.match(/holds:\[([^\]]*)\]/);
    return m ? [null, id, m[1]] : null;
  }).filter(Boolean);
  assert.equal(holds.length, 3, 'the holds entries were not all found');
  for (const [, id, list] of holds) {
    // The card's own pane, from the opening tag to the next card's.
    const start = page.indexOf(`data-card="${id}"`);
    assert.ok(start > 0, `no card pane for ${id}`);
    const rest = page.slice(start);
    const end = rest.indexOf('data-card="', 1);
    const pane = end > 0 ? rest.slice(0, end) : rest;
    for (const sel of list.split(',').map((x) => x.trim().replace(/^'|'$/g, ''))) {
      if (!sel) continue;
      // An id, a class, a tag, or a tag with a class — enough to tell
      // whether it is on the card. `details.about` is the compound one and
      // the reason this is not a one-liner.
      const needles = sel.startsWith('#') ? [`id="${sel.slice(1)}"`]
        : sel.startsWith('.') ? [`class="${sel.slice(1)}"`]
          : sel.includes('.')
            ? [`<${sel.split('.')[0]} class="${sel.split('.')[1]}"`]
            : [`<${sel}`, sel];
      assert.ok(needles.some((n) => pane.includes(n)),
        `${id} says it holds ${sel}, and the card does not`);
    }
  }
});

group('Asking for the evidence');

test('a request needs words, and not too many', async () => {
  const { validateMessage, MESSAGE_MIN, MESSAGE_MAX } = await import('../src/evidenceRequests.js');
  // A mail with no words reads like a phishing attempt, which is the one
  // thing a message asking a stranger for photographs must not look like.
  assert.equal(validateMessage('').ok, false);
  assert.equal(validateMessage('pls').reason, 'message-short');
  assert.equal(validateMessage('x'.repeat(MESSAGE_MAX + 1)).reason, 'message-long');
  assert.equal(validateMessage('  Could you send the clip?  ').text, 'Could you send the clip?');
  assert.ok(MESSAGE_MIN >= 10);
});

test('the link lasts days, not minutes, and says why', async () => {
  const { REQUEST_TTL_MS } = await import('../src/evidenceRequests.js');
  // The person being asked is a member of the public who may read their
  // mail on Sunday and has to find a file on a phone. accessLog.js's
  // five-minute grant is right for a moderator clicking through to a video
  // they are already looking at; here it would be a link that is always
  // dead.
  assert.ok(REQUEST_TTL_MS >= 7 * 24 * 60 * 60 * 1000, 'too short to be answerable');
  assert.ok(REQUEST_TTL_MS <= 30 * 24 * 60 * 60 * 1000, 'a month-old upload door');
  const src = fs.readFileSync(new URL('../src/evidenceRequests.js', import.meta.url), 'utf8');
  assert.match(src, /read their\s+\*?\s*mail on Sunday|mail on Sunday/,
    'the TTL is a judgement and the reasoning has to be written down');
});

test('the token is hashed, and the departure is admitted', () => {
  const src = fs.readFileSync(new URL('../src/evidenceRequests.js', import.meta.url), 'utf8');
  assert.match(src, /createHash\('sha256'\)/);
  // Nothing else here hashes an emailed token, so the migration says so
  // rather than implying it is house style. A comment that claims a
  // convention which does not exist is worse than no comment.
  const mig = fs.readFileSync(new URL('../migrations/041_evidence_requests.sql', import.meta.url), 'utf8');
  assert.match(mig, /THIS IS A DEPARTURE/);
  assert.match(mig, /report_submission_tokens\.token/,
    'the comment does not name what it is departing from');
});

test('the upload draft is DERIVED from the token, never the token itself', () => {
  // Reusing the request token as the draft token would write a working
  // link into upload_slots.draft_token in the clear, which is the whole
  // thing token_hash exists to avoid.
  const src = fs.readFileSync(new URL('../src/routes/evidence.js', import.meta.url), 'utf8');
  assert.match(src, /function draftTokenFor\(token\)/);
  assert.match(src, /createHash\('sha256'\)/);
  // And every use goes through it rather than passing the raw token.
  assert.ok(!/draft_token:\s*req\.params\.token/.test(src),
    'the raw request token is being used as a draft token somewhere');
  assert.ok(!/clearedSlotsFor\(req\.params\.token\)/.test(src));
});

test('several refusals are collapsed for a stranger, and two are not', () => {
  // "Expired", "already used" and "withdrawn" are all just "no longer
  // open" to somebody holding a stale mail, and telling them apart would
  // let anybody with a guessed token learn that a report exists and
  // something about its state.
  const src = fs.readFileSync(new URL('../src/routes/evidence.js', import.meta.url), 'utf8');
  const map = src.slice(src.indexOf('const REASONS'), src.indexOf('const refuse'));
  for (const r of ['bad-token', 'not-found', 'used', 'cancelled', 'expired', 'report-withdrawn']) {
    assert.match(map, new RegExp(`'?${r}'?:\\s*CLOSED`), `${r} tells a stranger too much`);
  }
  // The reporter's own switch is said plainly, because it is theirs to
  // turn back on and "no longer open" would be misleading about it.
  assert.match(map, /'permission-withdrawn':\s*'You have switched off/);
});

test('nothing on the reporter\'s door can read or change the report', () => {
  const src = fs.readFileSync(new URL('../src/routes/evidence.js', import.meta.url), 'utf8');
  // Three routes and no more: what was asked, stage a file, send them.
  const routes = [...src.matchAll(/router\.(get|post|put|delete)\('([^']*)'/g)]
    .map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(routes, ['get /:token', 'post /:token/slots', 'post /:token/submit'],
    'the unauthenticated door grew a route');
  // WHAT IT SENDS BACK, which is the question — not what it handles
  // internally. A guessed token must not become a way to read somebody's
  // account, so no response body may carry the report's answers.
  const sent = [...src.matchAll(/res(?:\.status\(\d+\))?\.json\(([\s\S]*?)\);/g)]
    .map((m) => m[1]).join('\n');
  assert.ok(sent.length > 0, 'no responses were found to check');
  assert.ok(!/answers/.test(sent), 'a response carries the report back');
  assert.ok(!/asked_by|askedBy/.test(sent),
    'a response names the moderator who asked');
  // And it never reaches Tier B at all.
  assert.ok(!/openRestricted|reports_restricted/.test(src), 'the door touches Tier B');
});

test('the permission is read at use, not at issue', async () => {
  const src = fs.readFileSync(new URL('../src/evidenceRequests.js', import.meta.url), 'utf8');
  // The gate that makes "switch this off and they stop asking" true. A
  // door that outlived the permission that opened it would make the
  // promise on the reporter's own page a lie.
  const redeem = src.slice(src.indexOf('export async function redeem'));
  assert.match(redeem, /permissionsFor\(/,
    'redeem does not consult the permission log');
  assert.match(redeem, /permission-withdrawn/);
  // Same rule renditions.js follows for publication.
  assert.match(src, /renditions\.js/, 'the shared rule is not pointed at');
});

test('a version is created by the module, so it can be tested', async () => {
  const ER = await import('../src/evidenceRequests.js');
  assert.equal(typeof ER.attachEvidence, 'function',
    'the version-creating code is back inside a route handler, where no test can reach it');
  const src = fs.readFileSync(new URL('../src/evidenceRequests.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function attachEvidence'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  // THE INVARIANT. The reporter was asked for files, not invited to revise
  // their account, and nothing on this path may change a word of it.
  assert.match(body, /answers: head\.answers \|\| undefined/,
    'the answers are being rebuilt rather than carried forward');
  assert.ok(!/buildAnswers/.test(body),
    're-validating would risk a different byte for the same meaning');
  // A new version, not an edit: reports is append-only.
  assert.match(body, /correctsId: head\.current_report_id/);
  assert.ok(!/UPDATE reports/.test(body), 'reports is append-only');
});

test('043 fixed a real bug, and the index can say why', () => {
  // An index predicate must be immutable, so it cannot test expires_at
  // against now() — which meant the first request to age out blocked every
  // later one, and the moderator was told to withdraw something that had
  // already stopped working.
  const mig = fs.readFileSync(new URL('../migrations/043_an_expired_ask_is_not_an_open_one.sql', import.meta.url), 'utf8');
  assert.match(mig, /expired_at/);
  assert.match(mig, /immutable/, 'nothing says why the index could not just test the clock');
  assert.match(mig, /expired_at IS NULL/, 'the new index does not test the new column');

  const src = fs.readFileSync(new URL('../src/evidenceRequests.js', import.meta.url), 'utf8');
  assert.match(src, /export async function expireStale/);
  // Stamped before asking, which is the only moment it has to be true.
  const create = src.slice(src.indexOf('export async function createRequest'));
  assert.match(create.slice(0, 1600), /expireStale\(/);
});

group('The review flag');

test('only a reporter\'s own prose is read, never the operator\'s wording', async () => {
  const { proseOf, PROSE_KINDS } = await import('../src/reviewFlags.js');
  // THE DISTINCTION THE FEATURE LIVES OR DIES ON. An operator who writes a
  // choice called "Turned away" would otherwise flag every report that
  // ticked it — and a term that fires on half of what arrives is how the
  // whole flag gets switched off.
  const fields = [
    { key: 'account', kind: 'long_text' },
    { key: 'name', kind: 'short_text' },
    { key: 'outcome', kind: 'choice_one' },
    { key: 'when', kind: 'date' },
    { key: 'where', kind: 'place' },
    { key: 'armed', kind: 'yes_no' },
  ];
  const got = proseOf({
    account: 'they turned me away', name: 'a short line',
    outcome: 'Turned away', when: '2026-11-03', where: 'A hall', armed: 'yes',
  }, fields);
  assert.match(got, /they turned me away/);
  assert.match(got, /a short line/);
  assert.ok(!got.includes('Turned away'), 'a choice label is being matched against');
  assert.ok(!got.includes('2026-11-03'));
  assert.ok(!got.includes('A hall'));
  // Deliberately short. A fifth prose kind is a decision, not an oversight.
  assert.deepEqual([...PROSE_KINDS].sort(), ['long_text', 'short_text']);
});

test('a value in an unexpected shape is skipped, not stringified', async () => {
  const { proseOf } = await import('../src/reviewFlags.js');
  // Otherwise '[object Object]' goes into the matcher, which matches
  // nothing but hides the fact that an answer was never read.
  const fields = [{ key: 'a', kind: 'long_text' }];
  assert.equal(proseOf({ a: ['x', 'y'] }, fields), '');
  assert.equal(proseOf({ a: { x: 1 } }, fields), '');
  assert.equal(proseOf({ a: 42 }, fields), '');
  assert.equal(proseOf(null, fields), '');
  assert.equal(proseOf({ a: 'kept' }, null), '', 'with no questions, nothing is prose');
});

test('nothing that computes a fingerprint imports the flag', async () => {
  // The keyword list is editable, so a flag in a report's fingerprint would
  // make it verify differently because somebody added a word months later.
  for (const f of ['reportCore.js', 'verify.js', 'chainFile.js', 'snapshot.js', 'formText.js']) {
    const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /reviewFlags/, `${f} imports the review flag`);
    assert.doesNotMatch(src, /needs_review|report_review_flags/, `${f} reads the flag`);
  }
});

test('the flag is never served to the public, nor rendered there', () => {
  // Two halves, because either alone is a half-removal. A reader seeing
  // "this report mentions a weapon" reads it as a finding about the report,
  // which is exactly what a flag is not.
  for (const f of ['routes/publicApi.js', 'reportSearch.js', 'stats.js', 'snapshot.js']) {
    const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /needs_review|review_terms/, `${f} publishes the flag`);
  }
  // And the card only draws it behind the moderator's own opts.review.
  const board = readPublic('js/board.js');
  const fn = board.slice(board.indexOf('function reviewFlagHtml'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /opts\s*&&\s*opts\.review/,
    'the marker is drawn without checking it is a moderator looking');
});

test('the card says what a flag is NOT, every time it says there is one', () => {
  // A marker that only says "flagged" gets read as a severity within a
  // week — which is the thing src/taxonomy.js withdrew the verdict to stop.
  const board = readPublic('js/board.js');
  const fn = board.slice(board.indexOf('function reviewFlagHtml'));
  const raw = fn.slice(0, fn.indexOf('\n}\n'));
  // The sentence is split across a string concatenation, so the quotes and
  // the + between them come out before matching. Checking the rendered
  // words rather than how they happen to be wrapped means reflowing the
  // source cannot fail this.
  const body = raw.replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' ');
  assert.match(body, /not a severity/, 'the card does not say it is not a severity');
  assert.match(body, /not a finding/);
  assert.match(raw, /review_terms/, 'the words that fired are not shown');
});

test('"I have read this" is a separate press from the moderation decision', () => {
  // A flag that cleared itself on Publish would make the queue a record of
  // what was published rather than of what was read.
  const mod = fs.readFileSync(new URL('../src/routes/moderators.js', import.meta.url), 'utf8');
  assert.match(mod, /router\.post\('\/reports\/:threadId\/reviewed'/);
  // The status route must not touch the flag.
  const statusFn = mod.slice(mod.indexOf("router.post('/reports/:threadId/status'"));
  assert.doesNotMatch(statusFn.slice(0, 1400), /clearFlag|needs_review/,
    'publishing a report clears its review flag');

  const js = readPublic('js/moderate.js');
  assert.match(js, /data-reviewed\]/, 'the button does nothing');
});

test('every path that creates a report reads what it says', () => {
  // A flag that only fired on the public form would be quietest exactly
  // where a coordinator is working through a stack of accounts at speed.
  for (const f of ['reports.js', 'me.js', 'intake.js']) {
    const src = fs.readFileSync(new URL(`../src/routes/${f}`, import.meta.url), 'utf8');
    assert.match(src, /flagReport\(client, \{/, `${f} files reports without reading them`);
  }
});

group('Every upload limit, as something an operator sets');

test('the ranges are stated once, and say what they are for', async () => {
  const A = await import('../src/attachments.js');
  const keys = Object.keys(A.LIMIT_RANGES);
  assert.equal(keys.length, 8, 'a limit was added or lost without its range');
  for (const [key, r] of Object.entries(A.LIMIT_RANGES)) {
    assert.ok(r.column && r.unit, `${key} has no column or unit`);
    assert.ok(r.min >= 1, `${key} allows zero — a form that can never be satisfied`);
    assert.ok(r.max > r.min, `${key} has an empty range`);
  }
});

test('a key nobody sent is absent, not set to its default', async () => {
  const { validateLimits } = await import('../src/attachments.js');
  // THE BUG THIS PINS. Writing every column on every save would set the
  // seven keys nobody touched, freezing that layer against every later
  // change underneath it — the opposite of what leaving a box empty means.
  const out = validateLimits({ maxFiles: 3 });
  assert.deepEqual(Object.keys(out.values), ['maxFiles']);
});

test('null and an emptied box both clear a limit; zero does not', async () => {
  const { validateLimits } = await import('../src/attachments.js');
  assert.equal(validateLimits({ maxFiles: null }).values.maxFiles, null);
  // An emptied number box arrives as '', and that is what emptying it looks
  // like to the person doing it.
  assert.equal(validateLimits({ maxFiles: '' }).values.maxFiles, null);
  // A 0 must be a refusal rather than a clear, or an operator aiming to
  // unset a limit would set the one value that breaks the form.
  assert.equal(validateLimits({ maxFiles: 0 }).ok, false);
});

test('a total under one file of that kind is refused', async () => {
  const { validateLimits } = await import('../src/attachments.js');
  // Each CHECK passes on its own, so the database cannot catch this: it is
  // a form that accepts a file and then refuses the report carrying it.
  const out = validateLimits({ maxTotalBytes: 2 * 1024 * 1024, maxVideoBytes: 100 * 1024 * 1024 });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'total-under-one-file');
  // And it only fires when BOTH are in the same save — a per-file ceiling
  // compared against an inherited total would refuse a legitimate change.
  assert.equal(validateLimits({ maxVideoBytes: 100 * 1024 * 1024 }).ok, true);
});

test('an unknown kind is refused rather than silently dropped', async () => {
  const { validateLimits } = await import('../src/attachments.js');
  assert.equal(validateLimits({ kinds: ['photo', 'hologram'] }).ok, false);
  // Taking none is a real answer and has to survive as itself.
  assert.deepEqual(validateLimits({ kinds: [] }).values.kinds, []);
  assert.equal(validateLimits({ kinds: null }).values.kinds, null);
  // Stored in ALL_KINDS order, so two deployments that chose the same kinds
  // report them identically.
  assert.deepEqual(validateLimits({ kinds: ['document', 'photo'] }).values.kinds,
    ['photo', 'document']);
});

test('the shipped defaults sit inside the ranges an operator is held to', async () => {
  const A = await import('../src/attachments.js');
  // Otherwise the panel shows a grey number it would refuse if typed, and
  // "back to the shipped numbers" produces a value that cannot be saved.
  const shipped = A.shippedLimits();
  for (const [key, r] of Object.entries(A.LIMIT_RANGES)) {
    assert.ok(shipped[key] >= r.min && shipped[key] <= r.max,
      `the shipped ${key} (${shipped[key]}) is outside ${r.min}–${r.max}`);
  }
});

test('nothing that computes a fingerprint reads an upload limit', async () => {
  // Same rule as the permissions log and the keyword list: a report must not
  // verify differently because an operator tuned a cap months later.
  for (const f of ['reportCore.js', 'verify.js', 'chainFile.js', 'snapshot.js']) {
    const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /limitsFor|limitLayers|LIMIT_RANGES/, `${f} reads a limit`);
  }
});

test('a limit is settable after launch, unlike every question', () => {
  // assertDraft guards everything that touches a question, because a
  // launched logbook's questions are sealed into every report filed against
  // it. A limit is not a question — and a cap that could only be set before
  // launch could never be corrected on the night it turned out to be wrong.
  const src = fs.readFileSync(new URL('../src/logbooks.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function setLogbookLimits'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.doesNotMatch(body, /assertDraft/,
    'the limits went behind the one-way door, where they cannot be corrected');
});

test('both limits panels are wired, and share one conversion', () => {
  const page = readPublic('index.html');
  // Two panels: the site's and a logbook's own.
  for (const id of ['panel-upload-limits', 'lim-save', 'lim-reset', 'lim-err', 'lim-state',
    'lb-limits-wrap', 'lblim-save', 'lblim-reset', 'lblim-err', 'lblim-state']) {
    assert.ok(page.includes(`id="${id}"`), `${id} is not on the page`);
  }
  // Eight rows each, and every row keyed to a limit the server knows.
  const keys = [...page.matchAll(/class="form_input lim-n"[^>]*data-key="(\w+)"/g)].map((m) => m[1]);
  assert.equal(keys.length, 16, 'a limit row is missing from one of the two panels');

  const js = readPublic('js/admin-settings.js');
  assert.match(js, /getElementById\('lim-save'\)\.addEventListener/, 'the site panel does nothing');
  assert.match(js, /getElementById\('lim-reset'\)\.addEventListener/);
  const builder = readPublic('js/logbook-builder.js');
  assert.match(builder, /getElementById\('lblim-save'\)\.addEventListener/, "the logbook panel does nothing");
  assert.match(builder, /getElementById\('lblim-reset'\)\.addEventListener/);

  // ONE COPY OF THE MEGABYTE CONVERSION. Two would round differently, and
  // two copies of "an empty box means inherit" is how one of them forgets.
  assert.match(builder, /limFill, limRead/, 'the builder has its own copy of the box logic');
  assert.ok(!/1024 \* 1024/.test(builder), 'the builder is converting megabytes itself');
});

test('the limit rows use CSS tokens that exist', () => {
  // Invented tokens render as nothing and look like a layout bug.
  const css = readPublic('css/page.css');
  const used = [...css.slice(css.indexOf('.limrow')).matchAll(/var\((--[a-z-]+)\)/g)]
    .map((m) => m[1]);
  const defined = readPublic('tokens.css') + readPublic('client-first.css');
  for (const t of new Set(used)) {
    assert.ok(defined.includes(`${t}:`), `${t} is not defined anywhere`);
  }
  assert.ok(used.length > 0, 'the limit rows were not found in page.css');
});

group('The words that raise a review flag');

test('a term is trimmed, lowercased, deduplicated and sorted', async () => {
  const { normalizeKeywords } = await import('../src/reviewKeywords.js');
  // Sorted so two deployments that typed the same terms in a different
  // order store the same list and a diff between them means something.
  assert.deepEqual(normalizeKeywords([' Turned Away ', 'threatened', 'TURNED AWAY', '', '  ']),
    ['threatened', 'turned away']);
  assert.equal(normalizeKeywords('not an array'), null, 'a string is not a list');
  assert.equal(normalizeKeywords(['x'.repeat(400)])[0].length, 120, 'a term is capped');
});

test('an empty list is a choice, and matches nothing rather than everything', async () => {
  const { keywordMatcher, matchedKeywords } = await import('../src/reviewKeywords.js');
  // The direction matters: a matcher built from nothing that matched
  // everything would flag every report on a deployment that deliberately
  // turned keyword matching off.
  assert.equal(keywordMatcher([]), null);
  assert.deepEqual(matchedKeywords('anything at all', []), []);
  assert.deepEqual(matchedKeywords('', ['gun']), [], 'no text is no match');
});

test('a phrase matches as a phrase and a word matches on its boundaries', async () => {
  const { matchedKeywords } = await import('../src/reviewKeywords.js');
  // The whole reason a noisy word becomes usable.
  assert.deepEqual(matchedKeywords('They turned me away at the door', ['turned me away']),
    ['turned me away']);
  assert.deepEqual(matchedKeywords('The count had begun', ['gun']), [],
    "'begun' must not read as a gun");
  assert.deepEqual(matchedKeywords('He had a gun.', ['gun']), ['gun']);
});

test("a term that starts or ends with punctuation keeps a looser edge", async () => {
  const { matchedKeywords } = await import('../src/reviewKeywords.js');
  // 'ar-15' ends in a digit and starts with a letter, so both edges are
  // word boundaries; the one that would break is a term whose own edge is
  // not a word character, where \b would demand one and never fire.
  assert.deepEqual(matchedKeywords('a man with an AR-15 outside', ['ar-15']), ['ar-15']);
  assert.deepEqual(matchedKeywords('he said (loudly) to leave', ['(loudly)']), ['(loudly)']);
});

test('an operator list is text, so a stray bracket cannot break the flag', async () => {
  const { keywordMatcher, matchedKeywords } = await import('../src/reviewKeywords.js');
  // Unescaped, this throws, and the flag stops running for every report on
  // the deployment — the failure a typo must not be able to cause.
  assert.doesNotThrow(() => keywordMatcher(['what(', '[', '*', 'a|b', '\\']));
  assert.deepEqual(matchedKeywords('he said what( then left', ['what(']), ['what(']);
});

test('the flag records which terms fired, not just that one did', async () => {
  const { matchedKeywords } = await import('../src/reviewKeywords.js');
  // A reviewer who cannot see what tripped it has to repeat the triage.
  assert.deepEqual(
    matchedKeywords('The judge turned me away and the police were called.',
      ['the judge', 'turned me away', 'police were called', 'threatened']),
    ['police were called', 'the judge', 'turned me away']);
});

test('the shipped list is normalized already, so it round-trips unchanged', async () => {
  const { DEFAULT_REVIEW_KEYWORDS, normalizeKeywords } = await import('../src/reviewKeywords.js');
  // If it were not, the first save of an unedited list would rewrite it and
  // read as an operator having made a change they did not make.
  assert.deepEqual(normalizeKeywords(DEFAULT_REVIEW_KEYWORDS), DEFAULT_REVIEW_KEYWORDS);
  assert.ok(DEFAULT_REVIEW_KEYWORDS.length > 100, 'the shipped list got gutted');
  assert.ok(DEFAULT_REVIEW_KEYWORDS.length <= 2000, 'past the ceiling 039 enforces');
});

test('nothing that computes a fingerprint reads the keyword list', async () => {
  // Same rule as src/reportPermissions.js: a report must not verify
  // differently because an operator added a word to a list months later.
  for (const f of ['reportCore.js', 'verify.js', 'chainFile.js', 'snapshot.js', 'formText.js']) {
    const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /reviewKeywords/, `${f} imports the keyword list`);
    assert.doesNotMatch(src, /review_keywords/, `${f} reads the keyword column`);
  }
});

test('the panel that edits the list is wired to the routes that store it', () => {
  // The half that has been missing before: markup with no handler is a
  // control that silently does nothing.
  const page = readPublic('index.html');
  for (const id of ['rkw-terms', 'rkw-state', 'rkw-err', 'rkw-save', 'rkw-reset']) {
    assert.ok(page.includes(`id="${id}"`), `${id} is not on the page`);
  }
  const js = readPublic('js/admin-settings.js');
  assert.match(js, /getElementById\('rkw-save'\)\.addEventListener/, 'Save does nothing');
  assert.match(js, /getElementById\('rkw-reset'\)\.addEventListener/, 'Reset does nothing');
  assert.match(js, /reset: true/, 'Reset posts a list instead of asking for the shipped one');

  // And something has to call the renderer, or the box opens empty.
  const builder = readPublic('js/logbook-builder.js');
  assert.match(builder, /renderReviewKeywords\(\)/, 'nothing fills the box');

  const admin = fs.readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  assert.match(admin, /router\.get\('\/review-keywords'/);
  assert.match(admin, /router\.post\('\/review-keywords'/);
});

test('the panel says which of the three states it is in', () => {
  // Not chosen, chosen, and chosen-as-empty are different things, and
  // showing the last as "using the defaults" would discard an operator's
  // decision the next time somebody pressed save.
  const js = readPublic('js/admin-settings.js');
  assert.match(js, /usingDefault/, 'the page cannot tell a chosen list from the shipped one');
  assert.match(js, /No keyword matching/, 'an empty list is not reported as a choice');
  assert.match(js, /defaultCount/, 'the shipped list is not counted for the reader');
});


import * as Lurls from '../src/lists/urls.js';
import * as Lret from '../src/lists/retention.js';
import * as Lfields from '../src/lists/fields.js';
import * as Lpolicy from '../src/lists/policy.js';
import * as Lvalues from '../src/lists/values.js';
import * as Ltemplates from '../src/lists/templates.js';
import { clustersIn } from '../src/lists/review.js';

/* The PURE half of src/lists/, and deliberately not index.js — that
   re-exports the write paths, which import src/db.js, which reads
   DATABASE_URL at import time. This suite takes no database. */
const L = { ...Lurls, ...Lret, ...Lfields, ...Lpolicy, ...Lvalues };

/* SQL comments are `--`, which stripComments above does not know about. */
function stripSqlComments(sql) {
  return sql.replace(/^\s*--.*$/gm, '');
}
const MIGRATION = fs.readFileSync(
  new URL('../migrations/046_lists.sql', import.meta.url), 'utf8');

function listSource(f) {
  return fs.readFileSync(new URL(`../src/lists/${f}`, import.meta.url), 'utf8');
}

/* ------------------------------------------------------------------ */
group('lists — the rules are testable without a database');

test('the five rule modules reach neither the pool nor the sealing code', () => {
  // This is what lets most of the checks below run in `npm test` rather
  // than only in `npm run test:db`. The rules are the part most worth
  // testing cheaply.
  for (const f of ['urls.js', 'retention.js', 'fields.js', 'policy.js', 'values.js']) {
    // Comments stripped: these files EXPLAIN the rule, and the explanation
    // of a ban must not trip the check that proves it.
    const src = stripComments(listSource(f));
    assert.ok(!/from\s+'\.\.\/db\.js'/.test(src), `${f} imports the pool`);
    assert.ok(!/reportCore/.test(src), `${f} reaches the sealing code`);
  }
});

/* ------------------------------------------------------------------ */
group('lists — the separation rule, which is the point of the design');

/* Every file reachable from src/lists/, following relative imports
   TRANSITIVELY. A per-file grep for `reportCore` is the obvious version of
   this test and it is the wrong one: it passes while the reach exists one
   hop away, and reach is what the rule is about. */
function listsGraph() {
  const dir = new URL('../src/lists/', import.meta.url);
  const seen = new Map();
  const queue = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
    .map((f) => new URL(f, dir));
  // AND THE ROUTES IN FRONT OF THEM. A list's HTTP layer reaching the
  // sealing code is the same breach one directory over, and the obvious
  // place for it to happen: a route borrowing a helper from a report route.
  queue.push(new URL('../src/routes/lists.js', import.meta.url));

  while (queue.length) {
    const u = queue.shift();
    if (seen.has(u.href)) continue;
    const src = fs.readFileSync(u, 'utf8');
    seen.set(u.href, src);
    const specs = [
      ...[...src.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
      ...[...src.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ];
    for (const s of specs) {
      if (!s.startsWith('.')) continue; // bare packages, node: builtins
      queue.push(new URL(s, u));
    }
  }
  return seen;
}

const SEALING_MODULES = [
  'reportCore.js', 'verify.js', 'chainFile.js', 'snapshot.js',
  'chainHeads.js', 'chainCheck.js', 'reportPermissions.js', 'answers.js',
];

test('the import walker actually follows edges', () => {
  // THE GUARD AGAINST A VACUOUS PASS. If the regex stopped matching, the
  // graph would be a dozen files importing nothing and the test below would
  // pass for the wrong reason, permanently.
  const hrefs = [...listsGraph().keys()];
  assert.ok(hrefs.some((h) => h.endsWith('/src/db.js')),
    'the walker did not follow ../db.js — it is not reading imports');
  assert.ok(hrefs.some((h) => h.endsWith('/src/fieldTypes.js')),
    'the walker did not follow ../fieldTypes.js — it is not reading imports');
  assert.ok(hrefs.filter((h) => h.includes('/lists/')).length >= 11,
    'the walker did not read the whole directory');
  assert.ok(hrefs.some((h) => h.endsWith('/src/routes/lists.js')),
    'the walker did not start from the list routes');
  assert.ok(hrefs.some((h) => h.endsWith('/src/authMiddleware.js')),
    'the walker did not follow the list routes\' own imports');
});

test('nothing a list can reach seals, chains or verifies a report', () => {
  for (const href of listsGraph().keys()) {
    for (const banned of SEALING_MODULES) {
      assert.ok(!href.endsWith(`/src/${banned}`),
        `a list can reach src/${banned} — an entry is not a report`);
    }
  }
});

test('and it writes to no chain, by name', () => {
  // The second layer. src/crypto.js is reachable and legitimately so — it
  // is where sha256Hex lives — but it also exports chainHash, chainGenesis
  // and GENESIS_HASH. Reaching the file is allowed; naming those is not.
  for (const [href, raw] of listsGraph()) {
    if (!href.includes('/lists/')) continue;
    const src = stripComments(raw);
    for (const forbidden of ['chainHash', 'chainGenesis', 'GENESIS_HASH',
      'report_heads', 'INSERT INTO reports', 'immutableFields', 'logbook_form']) {
      assert.ok(!src.includes(forbidden), `${href.split('/').pop()} names ${forbidden}`);
    }
  }
});

test('the list routes: who may do what is stated at the router', () => {
  const src = stripComments(fs.readFileSync(new URL('../src/routes/lists.js', import.meta.url), 'utf8'));
  assert.match(src, /adminRouter\.use\(requireRole\('admin'\)\)/,
    'building a list is an administrator\'s job');
  assert.match(src, /reviewRouter\.use\(requireRole\(\['moderator', 'admin'\]\)\)/,
    'approving entries is a moderator\'s job');
  // Nothing on the public router can approve or reject: the review calls
  // appear only after the review router is declared.
  const publicPart = src.slice(src.indexOf('publicRouter = express.Router()'), src.indexOf('adminRouter = express.Router()'));
  assert.ok(!/reviewEntries|setTriageState|updateSettings|replaceFields/.test(publicPart),
    'the public router reaches a write a visitor must never make');
});

test('a list nobody may see answers 404, never 403', () => {
  // 403 confirms the thing exists, and a hidden list's address is build state.
  const src = stripComments(fs.readFileSync(new URL('../src/routes/lists.js', import.meta.url), 'utf8'));
  const publicPart = src.slice(src.indexOf('publicRouter = express.Router()'), src.indexOf('adminRouter = express.Router()'));
  assert.ok(!/status\(403\)/.test(publicPart));
  for (const m of publicPart.matchAll(/if \(!maySee\([^)]*\)\) return res\.status\((\d+)\)/g)) {
    assert.equal(m[1], '404');
  }
  assert.ok((publicPart.match(/maySee\(/g) || []).length >= 2, 'the form and the filing both check visibility');
});

test('published counts need listed AND published, and nothing else reads them out', () => {
  const src = stripComments(fs.readFileSync(new URL('../src/routes/lists.js', import.meta.url), 'utf8'));
  const counts = src.slice(src.indexOf("publicRouter.get('/:slug/counts'"), src.indexOf('const FILE_REFUSALS'));
  assert.match(counts, /list\.visibility !== 'listed'/);
  assert.match(counts, /!list\.aggregates_published/);
  assert.ok(!/erasable/.test(counts), 'the public counts route names the erasable half');
});

test('opening an erasure link erases nothing — only the button does', () => {
  // Mail scanners and link previewers open every link in an email. If the
  // GET erased, a security product would delete people's words for them.
  const src = stripComments(fs.readFileSync(new URL('../src/routes/lists.js', import.meta.url), 'utf8'));
  const get = src.slice(src.indexOf("erasePage.get('/:token'"), src.indexOf("erasePage.post('/:token'"));
  assert.ok(get.length > 50, 'the GET handler was not found');
  assert.ok(!/redeem|erasePersonal|UPDATE/.test(get), 'the GET handler can erase');
  assert.match(get, /method="post"/);
});

test('the erasure page is in front of the site password, under /api/', () => {
  // A right is not behind a password. And under /api/ because every installed
  // box's nginx copy proxies /api/ and nothing added since.
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const at = server.indexOf("app.use('/api/forget', listErasePage)");
  const gate = server.indexOf("app.use('/api', asyncRoute(requireSiteAccess))");
  assert.ok(at > 0 && gate > at, 'the erasure page must be mounted before the site gate');
  const src = fs.readFileSync(new URL('../src/routes/lists.js', import.meta.url), 'utf8');
  assert.match(src, /\$\{SITE_ORIGIN\}\/api\/forget\//, 'the emailed link must point where the page is mounted');
});

test('a list has its own answer normalizer, because sharing one would breach the rule', () => {
  // src/answers.js does this job for reports and imports the sealing code.
  // The duplication is deliberate and is the price of the guarantee, so a
  // later session does not "fix" it by sharing the module.
  assert.ok(!stripComments(listSource('values.js')).includes('answers.js'));
  assert.ok(listSource('values.js').includes('fieldTypes.js'),
    'the two normalizers must at least share one field-type vocabulary');
});

test('the migration adds tables and touches nothing that exists', () => {
  const sql = stripSqlComments(MIGRATION);
  assert.ok(!/ALTER TABLE/i.test(sql), 'migration 046 alters an existing table');
  assert.ok(!/DROP /i.test(sql), 'migration 046 drops something');
  assert.ok(!/\breports\b/i.test(sql), 'migration 046 mentions the reports table');
  for (const t of ['lists', 'list_fields', 'list_entries', 'list_entry_links',
    'link_index', 'list_salts', 'list_erasures']) {
    assert.match(sql, new RegExp(`CREATE TABLE ${t}\\b`), `${t} is not created`);
  }
});

test('no list table carries a column called expires_at', () => {
  // src/sweep.js DELETEs whole rows from a hand-written list of tables
  // keyed on exactly that name. A list_entries with an `expires_at` is one
  // list edit away from deleting the links, and the links are the half that
  // stays.
  const sql = stripSqlComments(MIGRATION).replace(/CREATE TABLE list_erasures[\s\S]*$/, '');
  assert.ok(!/^\s*expires_at\s/m.test(sql),
    'a list row carries expires_at, which src/sweep.js would delete whole');
  assert.match(sql, /personal_expires_at\s+timestamptz/);
});

test('src/sweep.js has not quietly acquired a list table', () => {
  const src = fs.readFileSync(new URL('../src/sweep.js', import.meta.url), 'utf8');
  for (const t of ['list_entries', 'lists', 'link_index', 'list_entry_links', 'list_salts']) {
    assert.ok(!new RegExp(`'${t}'`).test(src),
      `src/sweep.js would DELETE rows from ${t}; a list erases columns`);
  }
});

test('lists are not in the archive export, and that is deliberate', () => {
  // The export is the claim that THE RECORD survives this operator. An
  // entry is a lead or a tally, is editable, and has its personal half
  // erased on a timer — so exporting it would write rows into a permanent
  // artifact the sweep is about to empty, and an import would resurrect
  // what somebody asked to have erased.
  const src = fs.readFileSync(new URL('../scripts/export-archive.js', import.meta.url), 'utf8');
  for (const t of ['lists', 'list_fields', 'list_entries', 'list_entry_links',
    'link_index', 'list_salts', 'list_erasures']) {
    assert.ok(!new RegExp(`['"\`]${t}['"\`]`).test(src),
      `the archive export has acquired ${t}, which the sweep is about to empty`);
  }
});

/* ------------------------------------------------------------------ */
group('lists — the two halves of an entry, which is the structural heart');

test('a count cannot reach anything erasable, because it is a different column', () => {
  // The strongest guarantee in the format, and it is in the shape rather
  // than in the care of whoever writes the next query: every aggregate
  // reads `answers`, and `erasable_answers` is not a word that appears in
  // the file at all.
  const src = stripComments(listSource('aggregates.js'));
  assert.ok(!src.includes('erasable_answers'),
    'an aggregate query can reach the erasable half');
  assert.ok(src.includes('answers'), 'the aggregate reads nothing at all');
});

const FORM = [
  { key: 'links', kind: 'url', label: 'Link', max_values: 3, retention: 'durable', required: true },
  { key: 'state', kind: 'choice_one', label: 'Where', retention: 'durable', aggregatable: true,
    options: { options: ['Ohio', 'Iowa'], allowOther: false } },
  { key: 'description', kind: 'long_text', label: 'Anything else', retention: 'transient' },
];

test('durable answers and erasable answers are split on the way in', () => {
  const out = L.prepareAnswers(FORM, {
    links: 'https://ex.org/a?utm_source=x',
    state: 'Ohio',
    description: 'something somebody typed',
  });
  assert.equal(out.ok, true);
  assert.deepEqual(Object.keys(out.answers).sort(), ['links', 'state']);
  assert.deepEqual(Object.keys(out.erasable), ['description']);
  // The link is stored normalized, so two spellings are one link.
  assert.deepEqual(out.answers.links, ['https://ex.org/a']);
  assert.equal(out.links.length, 1);
  assert.equal(out.links[0].host, 'ex.org');
});

test('nothing erasable means NULL, not an empty object', () => {
  // So the table's CHECK and the sweep agree about what "nothing" looks like.
  const out = L.prepareAnswers(FORM, { links: 'https://ex.org/a', state: 'Iowa' });
  assert.equal(out.erasable, null);
});

test('a key is absent when it was not answered, never null', () => {
  // An aggregate has to tell "never asked" from "asked and skipped", and a
  // null cannot carry that difference.
  const out = L.prepareAnswers(FORM, { links: 'https://ex.org/a', state: 'Ohio' });
  assert.ok(!('description' in out.answers));
  assert.ok(!Object.values(out.answers).includes(null));
});

test('a required question that was skipped names itself', () => {
  const out = L.prepareAnswers(FORM, { state: 'Ohio' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'missing-required');
  assert.deepEqual(out.keys, ['links']);
});

test('one person pasting the same link twice is one link', () => {
  // The whole value of a submission count is that it counts people.
  const out = L.prepareAnswers(FORM, {
    links: ['https://ex.org/a?utm_source=x', 'https://EX.org/a#top'], state: 'Ohio',
  });
  assert.equal(out.answers.links.length, 1);
  assert.equal(out.links.length, 1);
});

test('more values than the question allows is refused, not truncated', () => {
  const out = L.prepareAnswers(FORM, {
    links: ['https://a.com/1', 'https://b.com/2', 'https://c.com/3', 'https://d.com/4'],
    state: 'Ohio',
  });
  assert.equal(out.reason, 'too-many-values');
  assert.equal(out.key, 'links');
});

test('an answer outside a closed option set is refused', () => {
  assert.equal(L.prepareAnswers(FORM, { links: 'https://ex.org/a', state: 'Nowhere' }).reason,
    'not-an-option');
});

test('a field classed absent is not collected even when an answer arrives', () => {
  const form = [...FORM, { key: 'extra', kind: 'short_text', label: 'Extra', retention: 'absent' }];
  const out = L.prepareAnswers(form, {
    links: 'https://ex.org/a', state: 'Ohio', extra: 'typed anyway',
  });
  assert.ok(!('extra' in out.answers));
  assert.ok(!out.erasable || !('extra' in out.erasable));
});

/* ------------------------------------------------------------------ */
group('lists — the countable flag, and what SQL and JS must agree about');

test('the SQL CHECK and AGGREGATABLE_KINDS state the same list', () => {
  // Two statements of one rule drift. The upload limits have the same pair
  // and the same guard, for the same reason.
  const m = MIGRATION.match(/list_fields_aggregatable_check CHECK \(([\s\S]*?)\n  \)/);
  assert.ok(m, 'the CHECK constraint is not where this test looks for it');
  const inSql = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(inSql, [...L.AGGREGATABLE_KINDS].sort(),
    'migration 046 and src/lists/fields.js disagree about what can be counted');
});

test('free text can never be counted, whoever ticks the box', () => {
  assert.throws(() => L.assertFieldDefinition({
    key: 'description', kind: 'long_text', label: 'Anything else', aggregatable: true,
  }), /only a closed vocabulary/);
  assert.throws(() => L.assertFieldDefinition({
    key: 'name', kind: 'short_text', label: 'Name', aggregatable: true,
  }), /only a closed vocabulary/);
});

test('a choice with an escape hatch cannot be counted either', () => {
  // A place field with allow_other is a free text field most of the time,
  // and counting it would publish whatever people typed into the hatch.
  assert.throws(() => L.assertFieldDefinition({
    key: 'where', kind: 'place', label: 'Where', aggregatable: true,
    options: { options: ['Ohio'], allowOther: true },
  }), /escape hatch/);
  assert.doesNotThrow(() => L.assertFieldDefinition({
    key: 'where', kind: 'place', label: 'Where', aggregatable: true,
    retention: 'durable',
    options: { options: ['Ohio'], allowOther: false },
  }));
});

test('a field that is not collected cannot be counted', () => {
  assert.throws(() => L.assertFieldDefinition({
    key: 'state', kind: 'choice_one', label: 'Where', aggregatable: true,
    retention: 'absent', options: { options: ['Ohio'] },
  }), /not collected/);
});

test('a counted field that the sweep erases is refused, because its count would shrink', () => {
  // The trap this prevents: a number that falls on its own, months later,
  // with nobody connecting it to the sweep.
  assert.throws(() => L.assertFieldDefinition({
    key: 'where', kind: 'place', label: 'Where', aggregatable: true,
    retention: 'transient', options: { options: ['Ohio'], allowOther: false },
  }), /shrink on its own/);
});

test('every field needs a label, because that is what a count is named by', () => {
  assert.throws(() => L.assertFieldDefinition({ key: 'state', kind: 'choice_one' }),
    /has no label/);
});

test('uploads are not available on a list at all', () => {
  assert.throws(() => L.assertFieldDefinition({ key: 'photo', kind: 'file', label: 'Photo' }),
    /belong to a logbook/);
  assert.throws(() => L.assertCollectable([{ key: 'photo', kind: 'file', label: 'Photo' }],
    { hasRequiredEmail: true }), /belong to a logbook/);
});

test('two fields cannot share a key', () => {
  assert.throws(() => L.assertCollectable([
    { key: 'state', kind: 'choice_one', label: 'A', options: { options: ['x'] } },
    { key: 'state', kind: 'choice_one', label: 'B', options: { options: ['y'] } },
  ]), /share the key/);
});

/* ------------------------------------------------------------------ */
group('lists — the gate, derived from the fields and not ticked');

const LINK_ONLY = [
  { key: 'links', kind: 'url', label: 'Link' },
  { key: 'state', kind: 'choice_one', label: 'Where', options: { options: ['Ohio'] } },
];

test('a link and a dropdown asks for no address', () => {
  // There is nobody in the row to erase, so an address would be the only
  // personal thing on the form — collected in order to protect itself.
  const r = L.collectionRequirements(LINK_ONLY);
  assert.equal(r.collectsPersonal, false);
  assert.equal(r.requiresEmail, false);
  assert.doesNotThrow(() => L.assertCollectable(LINK_ONLY, { hasRequiredEmail: false }));
});

test('one free-text box makes the address required', () => {
  const withText = [...LINK_ONLY, { key: 'description', kind: 'long_text', label: 'More' }];
  const r = L.collectionRequirements(withText);
  assert.deepEqual(r.personalKeys, ['description']);
  assert.equal(r.requiresEmail, true);
  assert.equal(r.requiresErasureRoute, true);
  assert.throws(() => L.assertCollectable(withText, { hasRequiredEmail: false }),
    /must require an address/);
});

test('requiring an address of the FORM is not requiring one of every submission', () => {
  // The distinction a later session is most likely to collapse, and
  // collapsing it either way is a real fault. The Tip List OFFERS a
  // description and does not require one: somebody sending a link and two
  // dropdowns has handed over nothing personal and must not be asked for an
  // address, because that collects a contact detail in order to protect
  // itself. Somebody who writes a description must.
  //
  // So the form-level flag says "render an address field and explain the
  // erasure route", and src/lists/entries.js decides the submission from
  // what actually arrived.
  const form = [...LINK_ONLY, { key: 'description', kind: 'long_text', label: 'More' }];
  assert.equal(L.collectionRequirements(form).requiresEmail, true);

  const withText = L.prepareAnswers(form, { links: 'https://ex.org/a', description: 'words' });
  assert.notEqual(withText.erasable, null, 'free text must land in the erasable half');

  const withoutText = L.prepareAnswers(form, { links: 'https://ex.org/a' });
  assert.equal(withoutText.erasable, null,
    'a submission with no free text carries nothing erasable, so it needs no address');

  // entries.js must gate on the answers, never on the form's flag.
  const src = stripComments(listSource('entries.js'));
  assert.match(src, /prepared\.erasable && !address_/,
    'the submission gate does not read what actually arrived');
  assert.ok(!/req\.requiresEmail && !address_/.test(src),
    'the form-level flag is being used as a submission gate, which would refuse '
    + 'somebody who sent only a link');
});

test('an unknown field kind counts as personal', () => {
  // A field type added next year is one nobody remembered to classify. The
  // failure mode is an unnecessary email, not an unerasable record.
  assert.equal(L.isPersonalKind('voice_note_2027'), true);
  assert.equal(L.collectionRequirements([{ key: 'x', kind: 'voice_note_2027', label: 'X' }])
    .requiresEmail, true);
});

test('retention defaults by whether the field is personal', () => {
  assert.equal(L.defaultRetention('long_text'), L.CLASSES.TRANSIENT);
  assert.equal(L.defaultRetention('choice_one'), L.CLASSES.DURABLE);
  // Sweeping a state or a verdict would destroy the count for no gain.
  assert.equal(L.defaultRetention('yes_no'), L.CLASSES.DURABLE);
});

/* ------------------------------------------------------------------ */
group('lists — retention belongs to a field');

test('the period is read from configuration and never written as a literal', () => {
  assert.equal(L.personalRetentionDays({}), L.DEFAULT_PERSONAL_DAYS);
  assert.equal(L.personalRetentionDays({ LIST_PERSONAL_DAYS: '30' }), 30);
  assert.equal(L.personalRetentionDays({ LIST_PERSONAL_DAYS: 'never' }), L.NEVER);
});

test('a typo in the setting cannot turn retention off', () => {
  for (const bad of ['', '  ', '0', '-5', 'ninety', '90 days', '1.5']) {
    assert.equal(L.personalRetentionDays({ LIST_PERSONAL_DAYS: bad }),
      L.DEFAULT_PERSONAL_DAYS, `${JSON.stringify(bad)} did not fall back`);
  }
});

test('the expiry is computed forward from the moment of writing', () => {
  const at = L.personalExpiresAt(new Date('2026-10-10T12:00:00Z'), { LIST_PERSONAL_DAYS: '90' });
  assert.equal(at.toISOString(), '2027-01-08T12:00:00.000Z');
});

test('durable means NULL, which is what the column means', () => {
  assert.equal(L.personalExpiresAt(new Date(), { LIST_PERSONAL_DAYS: 'never' }), null);
});

test('the erasure link lives as long as the data it can erase', () => {
  const expiry = new Date('2027-01-08T12:00:00Z');
  assert.equal(L.erasureExpiry(expiry).toISOString(), expiry.toISOString());
  assert.equal(
    L.erasureExpiry(null, new Date('2026-10-10T00:00:00Z'), { LIST_ERASURE_LINK_DAYS: '10' })
      .toISOString(),
    '2026-10-20T00:00:00.000Z',
  );
});

test('the erasure names the columns it blanks', () => {
  assert.deepEqual(L.ERASABLE_COLUMNS, ['erasable_answers', 'email', 'ip_hash']);
  // link_index is absent on purpose: there is nobody in it to erase.
  assert.ok(!L.ERASABLE_COLUMNS.includes('link_index'));
});

/* ------------------------------------------------------------------ */
group('lists — normalizing a link');

test('host case, a trailing dot, and an internationalized name', () => {
  assert.equal(L.normalizeUrl('https://EXAMPLE.com/a').url, 'https://example.com/a');
  assert.equal(L.normalizeUrl('https://example.com./a').url, 'https://example.com/a');
  assert.equal(L.normalizeUrl('https://münchen.de/x').host, 'xn--mnchen-3ya.de');
});

test('tracking parameters go and the content ones stay', () => {
  assert.equal(L.normalizeUrl('https://ex.com/w?utm_source=t&fbclid=9&v=abc').url,
    'https://ex.com/w?v=abc');
  assert.match(L.normalizeUrl('https://www.youtube.com/watch?v=xyz&si=zz').url, /v=xyz/);
});

test('remaining parameters are sorted, so two apps produce one key', () => {
  assert.equal(L.normalizeUrl('https://ex.com/p?b=2&a=1').urlKey,
    L.normalizeUrl('https://ex.com/p?a=1&b=2').urlKey);
});

test('a fragment goes unless it carries a post identifier', () => {
  assert.equal(L.normalizeUrl('https://ex.com/p#top').url, 'https://ex.com/p');
  assert.equal(L.normalizeUrl('https://ex.com/p#:~:text=hello').url, 'https://ex.com/p');
  assert.equal(L.normalizeUrl('https://ex.com/p#comment-4821').url, 'https://ex.com/p#comment-4821');
});

test('what is rejected, and only what cannot be a link to public material', () => {
  const why = (u) => L.normalizeUrl(u).reason;
  assert.equal(why('ftp://ex.com/f'), L.REJECTIONS.SCHEME);
  assert.equal(why('javascript:alert(1)'), L.REJECTIONS.SCHEME);
  assert.equal(why('https://user:pw@ex.com/'), L.REJECTIONS.CREDENTIALS);
  assert.equal(why('https://bit.ly/abc'), L.REJECTIONS.SHORTENER);
  assert.equal(why('not a url'), L.REJECTIONS.UNPARSEABLE);
});

test('a bare address is refused in all four spellings it has', () => {
  const why = (u) => L.normalizeUrl(u).reason;
  for (const u of ['http://192.168.1.1/x', 'http://2130706433/x',
    'http://0x7f000001/x', 'http://[::1]/x']) {
    assert.equal(why(u), L.REJECTIONS.BARE_ADDRESS, u);
  }
});

test('youtu.be is NOT a shortener and must never become one', () => {
  assert.ok(!L.SHORTENERS.has('youtu.be'));
  assert.equal(L.normalizeUrl('https://youtu.be/dQw4w9WgXcQ?si=track').url,
    'https://youtu.be/dQw4w9WgXcQ');
});

test('url_key is sha256 of the normalized form, not of what was typed', () => {
  assert.equal(L.normalizeUrl('https://EX.com/p?utm_source=x').urlKey,
    crypto.createHash('sha256').update('https://ex.com/p').digest('hex'));
});

test('the server never fetches a submitted link', () => {
  // Not for a preview, not for a thumbnail, not to check that it resolves.
  // Fetching would turn the form into a way to make this server visit
  // arbitrary addresses, and would signal to whoever posted the material
  // that somebody looked.
  const src = stripComments(listSource('urls.js'));
  for (const io of ['fetch(', 'http.get', 'https.get', 'request(', 'axios', 'dns.']) {
    assert.ok(!src.includes(io), `urls.js performs I/O: ${io}`);
  }
});

/* ------------------------------------------------------------------ */
group('lists — one answer at a time');

test('a yes or no takes the spellings a form actually sends', () => {
  const f = { key: 'q', kind: 'yes_no', label: 'Q' };
  for (const yes of [true, 'true', 'yes', 'on', '1']) {
    assert.equal(L.normalizeValue(f, yes).value, true, String(yes));
  }
  for (const no of [false, 'false', 'no', 'off', '0']) {
    assert.equal(L.normalizeValue(f, no).value, false, String(no));
  }
  assert.equal(L.normalizeValue(f, 'maybe').ok, false);
});

test('several boxes ticked are stored sorted, so one answer has one shape', () => {
  const f = { key: 'q', kind: 'choice_many', label: 'Q',
    options: { options: ['b', 'a', 'c'], allowOther: false } };
  assert.deepEqual(L.normalizeValue(f, ['c', 'a']).value, ['a', 'c']);
  assert.deepEqual(L.normalizeValue(f, ['a', 'c']).value, ['a', 'c']);
  // Duplicates within one answer collapse.
  assert.deepEqual(L.normalizeValue(f, ['a', 'a']).value, ['a']);
});

test('a blank answer is undefined rather than an empty string', () => {
  const f = { key: 'q', kind: 'short_text', label: 'Q' };
  for (const blank of [null, undefined, '', '   ']) {
    assert.equal(L.normalizeValue(f, blank).value, undefined);
  }
});

test('text is capped, and a file kind never gets this far', () => {
  assert.equal(L.normalizeValue({ key: 'q', kind: 'long_text', label: 'Q' },
    'a'.repeat(1001)).reason, 'too-long');
  assert.equal(L.normalizeValue({ key: 'q', kind: 'file', label: 'Q' }, 'x').ok, false);
});

/* ------------------------------------------------------------------ */
group('lists — the shipped templates');

test('three templates ship, and all three parse', () => {
  const byslug = Object.fromEntries(Ltemplates.shippedTemplates().map((t) => [t.slug, t]));
  assert.deepEqual(Object.keys(byslug).sort(), ['check-ins', 'contact', 'tips']);
});

test('the Tip List requires an address, because it takes free text', () => {
  const t = Ltemplates.shippedTemplates().find((x) => x.slug === 'tips');
  assert.equal(t.requiresEmail, true);
  assert.deepEqual(t.fields.filter((f) => f.aggregatable).map((f) => f.key),
    ['state', 'category']);
  // The link question takes up to three and is durable: the links stay.
  const links = t.fields.find((f) => f.key === 'links');
  assert.equal(links.max_values, 3);
  assert.equal(links.retention, 'durable');
});

test('check-ins require no address, because nothing they collect is personal', () => {
  const t = Ltemplates.shippedTemplates().find((x) => x.slug === 'check-ins');
  assert.equal(t.requiresEmail, false);
  // Both questions countable, and both durable — so what survives the
  // sweep IS the count, with no rule needed to say so.
  assert.ok(t.fields.every((f) => f.aggregatable && f.retention === 'durable'));
});

test('a contact form ticks nothing countable, so a tool that asks finds nothing', () => {
  // A contact form ticks nothing as aggregatable, so if something pings it
  // there is nothing there.
  const t = Ltemplates.shippedTemplates().find((x) => x.slug === 'contact');
  assert.equal(t.fields.filter((f) => f.aggregatable).length, 0);
  assert.equal(t.requiresEmail, true);
});

test('a template that lies about needing an address fails to apply', () => {
  // The declaration exists to be CHECKED against what the fields mean, and
  // is then discarded — whether an address is required is derived, never an
  // operator's choice, because the gate must not be forgettable.
  assert.throws(() => Ltemplates.parseListTemplate({
    reportlog_list: 1, slug: 'bad', title: 'Bad', email: 'none',
    fields: [{ key: 'msg', kind: 'long_text', label: 'Message' }],
  }), /do NOT|DO require an address/);
});

test('a template that asks nothing is refused', () => {
  assert.throws(() => Ltemplates.parseListTemplate({
    reportlog_list: 1, slug: 'empty', title: 'Empty', fields: [],
  }), /asks nothing/);
});

test('nothing records which template made a list, and nothing may', () => {
  // src/templates.js states the rule: nothing reads "which template is
  // this" to decide anything, because that convenience ends as a permanent
  // fork in every query. So the Tip List, check-ins and a contact form are
  // the same code, and link handling happens because a list HAS a url field.
  const sql = stripSqlComments(MIGRATION);
  assert.ok(!/from_template|template_slug|template_id/.test(sql),
    'the schema records which template a list came from');
  // `kind` on list_fields is a FIELD's type and is fine. A kind on the list
  // itself would be the fork this rule exists to prevent.
  const listsTable = sql.slice(sql.indexOf('CREATE TABLE lists ('));
  assert.ok(!/^\s*kind\s+text/m.test(listsTable.slice(0, listsTable.indexOf(');'))),
    'the lists table has a kind column, which is a fork waiting to happen');
  for (const f of ['entries.js', 'aggregates.js', 'review.js', 'sweep.js']) {
    const src = stripComments(listSource(f));
    assert.ok(!/'tips'|'check-ins'|'contact'/.test(src),
      `${f} branches on which list it is looking at`);
  }
});

/* ------------------------------------------------------------------ */
group('lists — what a reviewer can see at a glance');

test('a repeated submitter is counted without the hash leaving the function', () => {
  // Fifty check-ins from one state in a minute is usually a local radio
  // mention. Fifty from one address is one person pressing a button. The
  // two look identical in a list of timestamps.
  const entries = [1, 2, 3, 4].map((id) => ({ id, createdAt: '2026-11-03T09:02:00Z' }));
  const rows = [{ ip_hash: 'aaa' }, { ip_hash: 'aaa' }, { ip_hash: 'aaa' }, { ip_hash: 'bbb' }];
  const c = clustersIn(entries, rows);
  assert.equal(c.repeatedSubmitters, 1);
  assert.equal(c.largestRepeatedSubmitter, 3);
  assert.deepEqual(c.entriesFromRepeatedSubmitters, [1, 2, 3]);
  assert.equal(JSON.stringify(c).includes('aaa'), false,
    'the hash itself is reported, and it should never leave the function');
});

test('a burst is visible even with no addresses at all', () => {
  // Which is why the constraint I first thought existed does not: the
  // timestamp is durable and never erased, so the shape of a flood survives
  // the sweep. Only one-person-fifty-times needs the address.
  const entries = [1, 2, 3].map((id) => ({ id, createdAt: '2026-11-03T09:02:00Z' }));
  const c = clustersIn(entries, [{}, {}, {}]);
  assert.equal(c.repeatedSubmitters, 0);
  assert.deepEqual(c.busiestMinutes[0], { minute: '2026-11-03T09:02', count: 3 });
});

test('an entry cannot be un-reviewed', () => {
  const src = stripComments(listSource('review.js'));
  assert.match(src, /cannot be un-reviewed/);
});


/* ------------------------------------------------------------------ */
group('lists — the guides, the sweep, and the promise it keeps');

test('both guides state the same table count, and it is the one the migrations build', () => {
  // THE FAULT THIS CATCHES ACTUALLY HAPPENED: both guides said 45 tables
  // while a freshly migrated database had 53, because migration 046 added
  // seven and nobody went back. A measured number in a document is a number
  // that starts lying the moment the schema moves, so it is derived here
  // instead of trusted.
  //
  // Derivable without a database: what the migrations create, less what
  // they drop, plus `schema_migrations` — which scripts/migrate.js creates
  // rather than any migration. Verified against a real fresh database at
  // 53 on 10 October.
  const sql = fs.readdirSync(new URL('../migrations/', import.meta.url))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'))
    .join('\n');
  const created = (sql.match(/^CREATE TABLE /gm) || []).length;
  const dropped = (sql.match(/^DROP TABLE |\bDROP TABLE /g) || []).length;
  const expected = created - dropped + 1;

  const install = fs.readFileSync(new URL('../INSTALL.md', import.meta.url), 'utf8');
  const docs = readPublic('docs.html');
  const inInstall = install.match(/across (\d+) tables/);
  const inDocs = docs.match(/(\d+) tables/);
  assert.ok(inInstall, 'INSTALL.md no longer states a table count where this looks');
  assert.ok(inDocs, 'docs.html no longer states a table count where this looks');
  assert.equal(Number(inInstall[1]), expected,
    `INSTALL.md says ${inInstall[1]} tables; the migrations build ${expected}`);
  assert.equal(Number(inDocs[1]), expected,
    `docs.html says ${inDocs[1]} tables; the migrations build ${expected}`);
});

test('the sweep timer runs BOTH sweeps, or a retention period is only a sentence', () => {
  // The digest shipped complete with no timer for either notify script, so
  // on every deployment that followed the guide people could subscribe and
  // nothing was ever sent, and the doctor reported a healthy box. This is
  // the same shape: src/lists/sweep.js existed and nothing called it, so
  // LIST_PERSONAL_DAYS was documented and unenforced.
  const src = stripComments(fs.readFileSync(
    new URL('../scripts/sweep.js', import.meta.url), 'utf8'));
  assert.match(src, /sweepExpired/, 'the credential sweep is not run');
  assert.match(src, /sweepLists/, 'THE LIST SWEEP IS NOT RUN — retention is a sentence only');
  // And the unit the timer actually starts has to be the script that does both.
  const unit = fs.readFileSync(
    new URL('../contrib/systemd/reportlog-sweep.service', import.meta.url), 'utf8');
  assert.match(unit, /scripts\/sweep\.js/);
});

test('all three places that describe the sweep say what it erases', () => {
  // It used to read "nothing breaks without it; the tables just grow",
  // which stopped being true the moment list retention rode on it.
  const install = fs.readFileSync(new URL('../INSTALL.md', import.meta.url), 'utf8');
  const docs = readPublic('docs.html');
  const unit = fs.readFileSync(
    new URL('../contrib/systemd/reportlog-sweep.service', import.meta.url), 'utf8');
  for (const [name, text] of [['INSTALL.md', install], ['docs.html', docs], ['the unit', unit]]) {
    assert.match(text, /erases the personal half|erases the personal/i,
      `${name} does not say the sweep erases personal data`);
  }
  assert.ok(!/deletes expired sign-in codes and sessions \| no — nothing breaks/.test(install),
    'INSTALL.md still calls the sweep timer harmless to skip');
});

test('the doctor asks for the sweep timer once a list holds something to erase', () => {
  // Optional on a deployment with no lists, required on one that collects —
  // the same shape as the digest timers, which are needed once somebody has
  // subscribed.
  const none = missingUnits(new Set(), { listRows: 0 }).required.map((u) => u.unit);
  const some = missingUnits(new Set(), { listRows: 3 }).required.map((u) => u.unit);
  assert.ok(!none.includes('reportlog-sweep.timer'),
    'the sweep timer is demanded on a deployment with nothing to erase');
  assert.ok(some.includes('reportlog-sweep.timer'),
    'A DEPLOYMENT HOLDING EXPIRING PERSONAL DATA IS NOT TOLD IT NEEDS THE TIMER');
  const why = missingUnits(new Set(), { listRows: 3 }).all
    .find((u) => u.unit === 'reportlog-sweep.timer').missing;
  assert.match(why, /NEVER ERASED/,
    'the doctor does not say what skipping it actually costs');
});


test('a guide that uses the word "list" also says what one is', () => {
  // THE GAP THIS CATCHES WAS ONE I MADE. Wiring list retention into the
  // sweep put "list entries" into both timer tables and made `npm run
  // doctor` print "list retention", while neither guide said what a list
  // was — so an operator met a term the guide never introduced. Did the
  // guide need to mention lists? It did, because the sweep row had already mentioned them.
  //
  // The rule: if a guide names the format, it has to define it. Not a
  // how-to — lists have no form yet, and a guide that told somebody to set
  // one up would be promising an interface that does not exist.
  const install = fs.readFileSync(new URL('../INSTALL.md', import.meta.url), 'utf8');
  const docs = readPublic('docs.html');
  for (const [name, text] of [['INSTALL.md', install], ['docs.html', docs]]) {
    if (!/list entries|list retention/.test(text)) continue;
    // WHITESPACE-TOLERANT, because HTML wrapping is arbitrary and a guard
    // that breaks when a paragraph reflows is a guard somebody deletes. The
    // 29 numeric step cross-references that broke when a step was inserted
    // are the lesson here.
    assert.match(text, /A\s+form\s+is\s+the\s+question\s+set/,
      `${name} names list entries without ever saying what a list is`);
    // And where they are made, so it does not read as a feature somebody
    // failed to find. It said "collects nothing yet" until the screens
    // shipped, and that guard went with the claim.
    assert.match(text, /Admin\s*(&rarr;|→)\s*Lists\s*(&rarr;|→)\s*Create\s+a\s+list/,
      `${name} describes lists without saying where they are made`);
  }
});

test('and it says what an operator must know before listing one', () => {
  // Three facts a guide that walks somebody into a list cannot leave out:
  // a new list is hidden (so "I made it and nobody can see it" is expected),
  // nothing anybody writes is published, and the erasure promise depends on
  // email — a form that collects words on a box with no mail sends a link
  // that never arrives.
  const install = fs.readFileSync(new URL('../INSTALL.md', import.meta.url), 'utf8');
  const docs = readPublic('docs.html');
  for (const [name, text] of [['INSTALL.md', install], ['docs.html', docs]]) {
    const flat = text.replace(/<[^>]+>/g, ' ').replace(/^>\s?/gm, '').replace(/\s+/g, ' ');
    assert.match(flat, /A new list starts hidden/, `${name} does not say a new list starts hidden`);
    assert.match(flat, /Nothing anybody writes is ever published/, `${name} does not say nothing written is published`);
    assert.match(flat, /It needs email to keep its promise/, `${name} does not say the erasure link needs email`);
  }
  // And the screen those guides name exists.
  const html = readPublic('index.html');
  assert.match(html, /data-adminsec="lists">Lists</, 'the guides name Admin → Lists and there is no such tab');
  assert.match(html, /id="ls-new">Create a list</, 'the guides name "Create a list" and there is no such button');
});


/* ------------------------------------------------------------------ */
group('a name typed at the install prompt is the name on screen');

// A test box's mail went out from "Test Log 2 [D [D [D [D [ [ [3~ …": the prompt
// kept the arrow keys pressed while typing. src/lineEdit.js replays them.
const { applyKeys, cleanTyped, hasKeystrokes, looksUnclean } = await import('../src/lineEdit.js');
const K = { L: '\x1b[D', R: '\x1b[C', DEL: '\x1b[3~', BS: '\x7f', HOME: '\x1b[H', END: '\x1b[F' };

test('arrow keys move, they are not text', () => {
  assert.equal(cleanTyped(`Test Log 2${K.L}${K.L}${K.BS}X`), 'Test LoX 2');
  assert.equal(cleanTyped(`abc${K.L}${K.L}${K.R}Z`), 'abZc');
});

test('delete removes forward, backspace backward, home and end jump', () => {
  assert.equal(cleanTyped(`abcd${K.HOME}${K.DEL}`), 'bcd');
  assert.equal(cleanTyped(`abcd${K.HOME}X${K.END}Y`), 'XabcdY');
  assert.equal(cleanTyped(`abc${K.BS}${K.BS}${K.BS}${K.BS}`), '');
});

test('the shape that reached an inbox comes out as text with no codes left', () => {
  const stored = `Test Log 2${K.L}${K.L}${K.L}${K.L}\x1b[\x1b[${K.DEL}${K.DEL}${K.DEL}${K.R}${K.R}${K.R}${K.R}\x1b[Log 2`;
  const meant = cleanTyped(stored);
  assert.ok(!/\x1b|\[D|\[C|\[3~/.test(meant), JSON.stringify(meant));
  assert.ok(hasKeystrokes(stored) && !hasKeystrokes(meant));
});

test('a plain name is left exactly as it is', () => {
  for (const n of ['Test Log 2', 'ReportLog', 'Ünïcödé — names', '']) assert.equal(cleanTyped(n), n);
  assert.equal(applyKeys('plain').edited, false);
});

test('ESC followed by ESC does not eat the sequence that follows it', () => {
  /* A REAL BUG, FOUND ON A TEST BOX. The ESC branch drops a two-byte
     Alt-something by skipping the next byte — and when that next byte was
     itself ESC, it threw away the introducer of a sequence that had only
     just begun, so the `[2~` after it was inserted as LITERAL TEXT. The
     name came out as "Test L[2~og 2", and once written to .env like that
     no amount of re-cleaning could repair it: the ESC bytes that made it a
     keystroke were gone. Pressing Escape then Insert does it. */
  assert.equal(cleanTyped('Test L\x1b\x1b[2~og 2'), 'Test Log 2');
  assert.equal(cleanTyped(`Test Log 2\x1b\x1b[D${K.L}`), 'Test Log 2');
  assert.equal(cleanTyped('abc\x1b\x1b\x1b[D'), 'abc');
  // ESC plus an ordinary character is still dropped, which is the behaviour
  // the branch was for.
  assert.equal(cleanTyped('Test\x1bxLog'), 'TestLog');
  assert.equal(cleanTyped('Test Log\x1b'), 'Test Log');
});

test('the doctor does not offer a value that is still broken', () => {
  /* THE WORST KIND OF ADVICE: confident and wrong. `npm run doctor` found a
     mangled ALERT_FROM_NAME on a test box, cleaned it, and printed

         edit .env and set ALERT_FROM_NAME=Test L[2og 2

     which is the broken value offered as the fix — and somebody would have
     pasted it. Replaying only works while the keystrokes are keystrokes;
     once the ESC bytes are gone what is left is ordinary text that happens
     to read as `[2`, and nothing can recover what was meant. So where the
     cleaned reading still looks like wreckage, the doctor says what it
     reads as and asks for the name that was meant. */
  assert.equal(looksUnclean('Test L[2og 2'), true, 'residue with no ESC is treated as clean');
  assert.equal(looksUnclean('Test L[2~og 2'), true);
  assert.equal(looksUnclean('Test Log 2'), false, 'a good name is called wreckage');
  assert.equal(looksUnclean('ReportLog'), false);
  assert.equal(looksUnclean(''), false);

  const doctor = fs.readFileSync(new URL('../scripts/doctor.js', import.meta.url), 'utf8');
  assert.match(doctor, /looksUnclean\(b\.meant\)/,
    'the doctor suggests the cleaned value without asking whether it is clean');
  assert.match(doctor, /to the name you meant/,
    'the doctor has no wording for a value it cannot work out');
  // The honest branch must come FIRST, or the confident one answers for both.
  assert.ok(doctor.indexOf('looksUnclean(b.meant)') < doctor.indexOf('set ${b.key}=${b.meant}'),
    'the unclean case is checked after the value has already been offered');
});

test('the prompt edits through it, and both names are read through it', () => {
  const prompt = stripComments(fs.readFileSync(new URL('../src/prompt.js', import.meta.url), 'utf8'));
  assert.match(prompt, /applyKeys\(/, 'the install prompt does not edit lines');
  assert.ok(!/current \+= ch/.test(prompt), 'the prompt appends raw bytes to the answer again');
  const email = stripComments(fs.readFileSync(new URL('../src/email.js', import.meta.url), 'utf8'));
  assert.match(email, /cleanTyped\(process\.env\.ALERT_FROM_NAME/, 'the sender name is not cleaned');
  const ident = stripComments(fs.readFileSync(new URL('../src/siteIdentity.js', import.meta.url), 'utf8'));
  assert.match(ident, /cleanTyped\(env\.SITE_NAME/, 'the site name from .env is not cleaned');
});

/* ------------------------------------------------------------------ */
group('list counts, published beside the anchor');

const { countsRecord, countsDigestMatches, COUNTS_FORMAT } = await import('../src/countsFile.js');
const sampleDoc = { lists: [{ slug: 'check-ins', title: 'How did it go?', definition: [{ key: 'verdict', label: 'How', kind: 'choice_one', options: null }],
  totals: { received: 5, approved: 3, rejected: 1, lastEntry: '2026-10-10T00:00:00Z' },
  fields: [{ key: 'verdict', label: 'How', kind: 'choice_one', values: [{ value: 'It went fine', received: 4, approved: 3 }] }] }] };

test('the counts file carries a digest anybody can recompute from it', () => {
  const rec = countsRecord('2026-10-10', sampleDoc);
  assert.equal(rec.counts_format, COUNTS_FORMAT);
  assert.ok(countsDigestMatches(rec));
  // Changing any count after the fact breaks it — the property the file exists for.
  const edited = JSON.parse(JSON.stringify(rec));
  edited.lists[0].totals.approved = 4;
  assert.ok(!countsDigestMatches(edited));
});

test('and it publishes received and approved only — no rejected count, no timestamps of entries', () => {
  const rec = countsRecord('2026-10-10', sampleDoc);
  assert.deepEqual(Object.keys(rec.lists[0].totals).sort(), ['approved', 'received']);
  assert.ok(!JSON.stringify(rec).includes('lastEntry'));
});

test('the anchor publishes counts AFTER the reports are anchored, and cannot be stopped by them', () => {
  const a = stripComments(fs.readFileSync(new URL('./anchor.js', import.meta.url), 'utf8'));
  const insertAnchor = a.indexOf('INSERT INTO chain_anchors');
  const snapshotWrite = a.indexOf("'snapshots', `${date}.json`");
  const counts = a.indexOf('snapshotDocument(');
  assert.ok(insertAnchor > 0 && snapshotWrite > insertAnchor && counts > snapshotWrite,
    'counts must come after the anchor row and the snapshot file');
  const block = a.slice(a.lastIndexOf('try {', counts), a.indexOf("execFileSync('git', ['add'"));
  assert.match(block, /catch \(e\)/, 'a counts failure must be caught, not abort the anchor');
  assert.ok(!/process\.exit|throw e/.test(block.slice(block.indexOf('catch (e)'))),
    'the counts failure path must not end the run');
  assert.match(a, /'git', \['add', \.\.\.toAdd\]/);
});

test('the anchor format itself is untouched by the counts', () => {
  // Every published anchor is checked against {anchor_format, date, chains}.
  const ch = stripComments(fs.readFileSync(new URL('../src/chainHeads.js', import.meta.url), 'utf8'));
  assert.match(ch, /canonicalize\(\{ anchor_format: ANCHOR_FORMAT, date, chains: heads \}\)/);
  assert.ok(!/counts/.test(ch));
});

/* ------------------------------------------------------------------ */
group('numbers in an operator\'s own wording');

const FIG = await import('../src/figures.js');
const V = { 'reports.filed.7d': 12, 'list.check-ins.approved.all': 40, 'list.check-ins.verdict.abc123.approved.all': 30 };

test('a placeholder becomes the figure, with separators', () => {
  assert.equal(FIG.renderText('In the last week {{ [reports.filed.7d] }} reports were filed.', V),
    'In the last week 12 reports were filed.');
  assert.equal(FIG.renderText('{{ [reports.filed.7d] * 1000 }}', V), '12,000');
});

test('calculations: arithmetic, brackets, percent and round, any figures', () => {
  assert.equal(FIG.renderText('{{ percent([list.check-ins.verdict.abc123.approved.all], [list.check-ins.approved.all]) }}%', V), '75%');
  assert.equal(FIG.renderText('{{ ([reports.filed.7d] + 3) / 2 }}', V), '7.5');
  assert.equal(FIG.renderText('{{ round(percent(1, 3), 2) }}', {}), '33.3');
  assert.equal(FIG.renderText('{{ -[reports.filed.7d] + 2 }}', V), '-10');
  // Across formats, too — arithmetic works on basically anything.
  assert.equal(FIG.renderText('{{ [reports.filed.7d] / [list.check-ins.approved.all] * 100 }}', V), '30');
});

test('nothing in the braces is ever run as code', () => {
  for (const evil of ['process.exit()', 'constructor', 'this', '1;2', '`x`', 'require("fs")', 'a=1', '[x] [y]']) {
    assert.equal(FIG.renderText(`{{ ${evil} }}`, V), '?', evil);
  }
  const src = stripComments(fs.readFileSync(new URL('../src/figures.js', import.meta.url), 'utf8'));
  assert.ok(!/\beval\(|new Function|\bFunction\(/.test(src), 'the figures module evaluates code');
});

test('an unknown figure or a broken sum shows "?", never the raw placeholder', () => {
  assert.equal(FIG.renderText('{{ [nope] }} and {{ 2 + }}', V), '? and ?');
  assert.equal(FIG.renderText('{{ 1 / 0 }}', V), '—');
});

test('the editor is told what is wrong before it is saved', () => {
  const p = FIG.checkText('{{ [nope] }} {{ percent(1) }} {{ [reports.filed.7d] }}', V);
  assert.equal(p.length, 2);
  assert.match(p[0], /no figure called \[nope\]/);
  assert.match(p[1], /percent takes 2/);
});

test('an answer\'s name survives its options being reordered', () => {
  assert.equal(FIG.valueId('It went fine'), FIG.valueId('It went fine'));
  assert.notEqual(FIG.valueId('It went fine'), FIG.valueId('Something went wrong'));
  assert.match(FIG.valueId('x'), /^[0-9a-f]{6}$/);
});

test('only lists whose counts are published and listed offer figures', () => {
  const src = fs.readFileSync(new URL('../src/figures.js', import.meta.url), 'utf8');
  assert.match(src, /WHERE aggregates_published AND visibility = 'listed'/);
  assert.match(src, /WHERE list_id = \$1 AND aggregatable/);
  assert.ok(!/erasable_answers/.test(src), 'a figure could reach what somebody wrote');
});

test('the public text route renders, and the editor saves only text that works', () => {
  const legal = fs.readFileSync(new URL('../src/routes/legal.js', import.meta.url), 'utf8');
  assert.match(legal, /res\.json\(await renderCopy\(await siteCopy\(\)\)\)/);
  const admin = fs.readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  assert.match(admin, /checkText\(check\.value, await figureValues\(\)\)/);
});

/* ------------------------------------------------------------------ */
group('what gets past the site password');

test('the allow-list for logbooks opened outside names no staff or account route', () => {
  const src = stripComments(fs.readFileSync(new URL('../src/doors.js', import.meta.url), 'utf8'));
  const body = src.slice(src.indexOf('export async function outsidePass'));
  for (const never of ['/admin', '/moderators', '/me', '/auth', '/orgs', '/intake/', '/list-review', '/stats']) {
    assert.ok(!body.includes(`'${never}`) && !body.includes(`"${never}`) && !body.includes(`\\${never}`),
      `outsidePass names ${never}`);
  }
  // And it passes nothing unless some logbook is actually open outside.
  assert.match(body, /if \(!open\.length\) return false;/);
  // The list of logbooks would name the shut ones; it is not on the list.
  assert.ok(!/path === '\/logbooks'/.test(body));
});

test('the gate reads the mark the allow-list sets, and nothing a client sends', () => {
  const sa = stripComments(fs.readFileSync(new URL('../src/siteAccess.js', import.meta.url), 'utf8'));
  assert.match(sa, /if \(req\.outsidePass === true\) return next\(\);/);
  const server = stripComments(fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8'));
  assert.match(server, /if \(!\(await hasSiteAccess\(req\)\) && await outsidePass\(req\)\) req\.outsidePass = true;/);
  assert.ok(server.indexOf('req.outsidePass = true') < server.indexOf("app.use('/api', asyncRoute(requireSiteAccess))"));
});

test('a list may only be open outside while it is listed, in the database itself', () => {
  assert.match(m047, /CHECK \(outside_access = 'closed' OR visibility = 'listed'\)/);
});

/* ------------------------------------------------------------------ */
group('browsers ask before using an old script');

test('cache.conf makes scripts, styles and pages revalidate, and keeps the policy on them', () => {
  const c = stripComments(fs.readFileSync(new URL('../contrib/nginx/cache.conf', import.meta.url), 'utf8'));
  assert.match(c, /location ~\* \\\.\(\?:js\|css\|html\)\$ \{/);
  assert.match(c, /add_header Cache-Control "no-cache" always;/);
  // An add_header in a location drops every inherited one, so the policy is
  // repeated — the same rule = /sw.js follows.
  assert.match(c, /include \/srv\/reportlog\/contrib\/nginx\/csp\.conf;/);
  const tpl = fs.readFileSync(new URL('../contrib/nginx/reportlog.conf', import.meta.url), 'utf8');
  assert.match(tpl, /include \/srv\/reportlog\/contrib\/nginx\/cache\.conf;/, 'the template does not include cache.conf');
});

test('the updater reloads nginx only after nginx -t passes, and never fails an update over it', () => {
  const u = fs.readFileSync(new URL('../contrib/update-apply.sh', import.meta.url), 'utf8');
  const health = u.indexOf('/api/health');
  const reload = u.indexOf('systemctl reload nginx');
  assert.ok(health > 0 && reload > health, 'nginx is reloaded before the app is known to be answering');
  const block = u.slice(u.lastIndexOf('if nginx -t', reload), reload);
  assert.ok(block.length && block.length < 200, 'the reload is not behind nginx -t');
  const tail = u.slice(u.indexOf('# --- nginx, to reload it'));
  assert.ok(!/give_up|exit 1/.test(tail.slice(0, tail.indexOf('write_status done'))), 'an nginx problem fails the update');
});

/* ------------------------------------------------------------------ */
group('what build is this — the commit AND the schema');

test('the update button is not offered when nothing would act on it', () => {
  /* THE BUG THIS CLOSES, which was the whole feature not working.

     The application cannot apply an update. It leaves a file naming a
     commit and a ROOT SYSTEMD TIMER does the fetching, backing up,
     installing and restarting. Nothing ever asked whether that timer was
     there — so on a box without it the pane offered the button, answered
     "Asked for. It starts within a minute", and the request sat in `var/`
     forever. No error, nothing in a log, nothing to grep for.

     How a box gets there without anybody doing anything wrong:
     `install-units.sh` enables every unit and is run once at install;
     `deploy.sh` pulls, migrates and restarts and installs no units. So the
     release that ADDED this feature added its own timer, and every box
     upgraded with deploy.sh got the button without the worker. */
  const { classifyIsEnabled, canApply, reasonFor, WORKER_UNIT } = workerModule;

  // The three answers systemctl really gives, and they are three and not two.
  assert.equal(classifyIsEnabled({ ok: true, stdout: 'enabled\n' }), true);
  assert.equal(classifyIsEnabled({ ok: false, stdout: 'disabled\n', code: 1 }), false);
  assert.equal(classifyIsEnabled({ ok: false, stdout: 'masked\n', code: 1 }), false);
  assert.equal(classifyIsEnabled({
    ok: false, stdout: 'not-found\n', code: 1, message: 'could not be found',
  }), false, 'a unit that is not installed reads as something other than absent');
  // `is-enabled` EXITS NON-ZERO FOR A DISABLED UNIT and prints the state on
  // stdout, so the answer is inside the error. Reading only the success
  // path would call every disabled timer "could not check" — the wrong half
  // of the tri-state, which puts the button back.
  assert.notEqual(classifyIsEnabled({ ok: false, stdout: 'disabled\n', code: 1 }), null,
    'a disabled timer is being classified as unknowable');

  // And a box with no systemd to ask is a THIRD state, not a missing timer.
  assert.equal(classifyIsEnabled({ ok: false, code: 'ENOENT', message: 'spawn systemctl ENOENT' }), null);
  assert.equal(classifyIsEnabled({
    ok: false, code: 1, message: 'System has not been booted with systemd as init system',
  }), null);

  // Only a confirmed yes offers the button. Both not-listening states, and
  // a payload with no worker at all, say no.
  assert.equal(canApply({ listening: true }), true);
  assert.equal(canApply({ listening: false }), false);
  assert.equal(canApply({ listening: null }), false);
  assert.equal(canApply(undefined), false, 'a missing worker reads as a working one');

  // Every refusal names what to do, and names it the same way the guide does.
  for (const state of [false, null]) {
    const why = reasonFor(state);
    assert.ok(why && why.length > 40, `no sentence for listening=${state}`);
  }
  /* WORDED AS AN UNFINISHED SETUP AND NOT AS A LIMITATION. "This deployment
     cannot install an update" is a true sentence that leaves somebody
     stuck; the box is one command short and the sentence should say so. */
  assert.ok(!/cannot/i.test(reasonFor(false)),
    'a missing timer is described as something the software cannot do');
  assert.match(reasonFor(false), /never installed|one command/i,
    'the missing timer is not described as an unfinished setup');
  // No systemd at all is the one case with nothing to install, so it is the
  // one that sends somebody to SSH.
  assert.match(reasonFor(null), /contrib\/deploy\.sh/,
    'a box with no systemd is not told how to update at all');
  // THE COMMAND IS ITS OWN FIELD, so the pane can print it on its own line
  // for copying rather than leaving somebody to pick it out of a sentence.
  assert.match(workerModule.fixFor(false), /install-units\.sh/,
    'a missing timer is reported without the one command that installs it');
  assert.equal(workerModule.fixFor(true), null, 'a working deployment is given a command to run');
  assert.equal(workerModule.fixFor(null), null,
    'a box with no systemd is told to run something that would not help');
  assert.equal(reasonFor(true), null, 'a working deployment is told something anyway');
  assert.equal(WORKER_UNIT, 'reportlog-update.timer');
});

test('the route refuses an update nothing would act on, and the pane hides the button', () => {
  // TWO HALVES AND BOTH ARE NEEDED. Hiding the button is not enough on its
  // own: a page left open across an install, a second tab, or a curl would
  // each write a request that sits in var/ forever while the pane promises
  // it starts within a minute. The refusal is what makes that impossible
  // rather than unlikely.
  const admin = fs.readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  const post = admin.slice(admin.indexOf("router.post('/update'"));
  assert.match(post.slice(0, 900), /canApply\(worker\)/,
    'the POST writes a request without asking whether anything will read it');
  assert.ok(post.indexOf('canApply(worker)') < post.indexOf('writeRequest'),
    'the request is written before the refusal, so it is written anyway');
  assert.match(admin, /worker \}\);|worker,/, 'the GET does not report the worker');

  /* THE BUTTON IS NOT HIDDEN, and that is deliberate after getting it wrong
     once. Hiding a control is a polite way of saying the feature does not
     work: it leaves an operator with an empty panel and no idea what to do.
     Updating from the admin page is meant to work, so the button stays, the
     panel says the one thing standing in the way and prints the command,
     and the ROUTE is what refuses — so pressing it cannot pretend to have
     succeeded. */
  const js = readPublic('js/admin-updates.js');
  assert.match(js, /apply\.hidden = !\(st\.hasUpdate && !busy\)/,
    'the button is hidden again for a missing worker, which only hides the problem');
  assert.ok(!/!busy && !noWorker/.test(js),
    'the worker is back in the button condition');
  assert.match(js, /One step is missing/,
    'the pane does not say what is standing in the way');
  assert.match(js, /worker\.fix/,
    'the pane does not print the command that fixes it');

  // AND THE DOCTOR'S COMMENT HAS TO MATCH. It asserted this behaviour for
  // weeks while nothing implemented it, which is how the claim rotted.
  const doctor = fs.readFileSync(new URL('../src/doctor.js', import.meta.url), 'utf8');
  assert.match(doctor, /src\/updateWorker\.js` is what makes it true/,
    'doctor.js claims the pane reports a missing worker without pointing at what does it');
});

test('nothing in the worker probe is built from a request', () => {
  /* The same rule src/updateCheck.js is held to, for the same reason: this
     runs in the web process. One fixed argument list, no shell, bounded,
     and systemd's own output never reaches the browser — a sentence written
     in the module is returned instead, because output from a tool can carry
     things that should not be rendered. */
  const src = fs.readFileSync(new URL('../src/updateWorker.js', import.meta.url), 'utf8');
  assert.match(src, /run\('systemctl', \['is-enabled', WORKER_UNIT\]/,
    'the probe does not pass a fixed argument list');
  assert.match(src, /shell: false/, 'the probe may run through a shell');
  assert.match(src, /timeout: PROBE_TIMEOUT_MS/, 'the probe is unbounded');
  assert.ok(!/req\b|request\./.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')),
    'the probe reads something from a request');
  // The reasons are fixed strings in the module, not anything systemd said.
  assert.ok(!/e\.stderr|err\.stderr|\.stdout\b.*reason/.test(src),
    'systemd output is being put into the reason shown to a browser');
});

test('deploying INSTALLS a new or changed unit, rather than mentioning it', () => {
  /* THE MECHANISM THAT LET THE UPDATE TIMER GO MISSING, and the first fix
     for it was not good enough. deploy.sh pulls, migrates and restarts; it
     installed no units and never looked at `contrib/systemd/` at all — so a
     release that adds a timer deployed the code and left the timer
     uninstalled. That is how `reportlog-update.timer` went missing on every
     box upgraded over SSH, which is why the Updates button did nothing.

     Warning about it was the first attempt. A warning is a thing somebody
     scrolls past, and the whole complaint was that the button has to work —
     so it installs them.

     NOT A NEW PRIVILEGE: this script already sudo's to restart the service,
     so sudo is already assumed available where it runs. */
  const sh = fs.readFileSync(new URL('../contrib/deploy.sh', import.meta.url), 'utf8');
  assert.match(sh, /git diff --name-only "\$BEFORE" HEAD -- contrib\/systemd\//,
    'deploy.sh does not notice a new or changed unit file');
  assert.match(sh, /sudo "\$REPO\/contrib\/install-units\.sh"/,
    'deploy.sh still only mentions the units instead of installing them');

  // BEFORE THE RESTART, so the service comes up with the timers its own
  // release expects rather than a minute later.
  assert.ok(sh.indexOf('sudo "$REPO/contrib/install-units.sh"')
    < sh.indexOf('sudo systemctl restart "$SERVICE"'),
  'the units are installed after the restart, so the service starts without them');

  // And when it could NOT install them — no sudo, no systemctl, a failed
  // run — the notice still says what is owed. Not fatal: the code is
  // already on disk and the service still has to come back.
  assert.match(sh, /units_notice/, 'nothing reports units that could not be installed');
  assert.match(sh, /could NOT be installed here/,
    'the fallback notice does not say that installing them did not happen');
  assert.ok(/\[ -z "\$UNITS_INSTALLED" \] \|\| return 0/.test(sh),
    'the notice fires even when the units were installed, which reads as a failure');
});

test('the updates endpoint answers with the schema, not only the commit', () => {
  // THE QUESTION THIS ANSWERS was asked by an operator who had just
  // installed from stable and could not tell whether the feature he had
  // built was on the box. The commit hash did not answer it, and the commit
  // hash was all anything showed.
  const admin = fs.readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  assert.match(admin, /schemaState/, 'the endpoint cannot report the schema');
  /* ASSERTED ON THE PAYLOAD'S KEYS RATHER THAN ON ITS BRACES. This was
     `/schema\s*\}\)\);/` — the shape of the end of the line — so adding a
     key after `schema` broke it while the thing it checks was still true.
     A guard that fails on a change it does not care about is a guard
     somebody edits without reading. */
  const payload = (admin.match(/res\.json\(\{ \.\.\.check,[^}]*\}\)/) || [])[0] || '';
  assert.ok(payload, 'the updates endpoint no longer answers with one object');
  for (const key of ['schema', 'status', 'busy', 'history']) {
    assert.ok(new RegExp(`\\b${key}\\b`).test(payload),
      `the updates payload does not carry ${key}, so it is computed and not returned`);
  }
});

test('the pane shows the whole commit, not a prefix nobody can use', () => {
  // Eight characters is enough to read and not enough to paste into
  // `git show` with confidence, and the question is answered by comparing
  // it to a commit somebody has in front of them.
  const js = readPublic('js/admin-updates.js');
  assert.match(js, /title="\$\{esc\(commit\)\}"/,
    'the full commit is not available to the reader');
  assert.ok(!/currentCommit \|\| ''\)\.slice\(0, 8\)/.test(js),
    'the pane still truncates the commit to eight characters');
});

test('the pane says when the deployment last checked, and the button reacts', () => {
  /* TWO FAULTS WITH ONE CAUSE: nothing on the panel reported the age of
     what it was claiming.

     `checkForUpdate()` caches for ten minutes, so "Up to date" on a
     freshly opened pane can be nine minutes old — and the server had been
     sending `checkedAt` all along, unrendered. Meanwhile "Check now" runs
     a `git fetch` bounded at twenty seconds, and when the answer comes
     back unchanged the panel afterwards is byte-identical to the panel
     before. So the button was indistinguishable from a dead one for up to
     twenty seconds, and the slow cases are the honest ones: an
     unreachable remote waits out the whole timeout. */
  const js = readPublic('js/admin-updates.js');
  assert.match(js, /checkedAt/, 'the pane never reads checkedAt');
  assert.match(js, /renderChecked\(d\)/,
    'the checked-at line is not rendered from the payload');
  assert.match(js, /aria-busy/, 'the check button gives no busy state');
  assert.match(js, /Checking…/, 'the check button never says it is working');
  assert.match(js, /finally\s*\{/,
    'the button is restored outside a finally, so a thrown fetch leaves it stuck');
  // A failed fetch is still a check. Reporting only "checked" for one
  // claims a comparison against the remote that did not happen.
  assert.match(js, /fetched === false/,
    'a check that could not reach the remote reads as one that did');

  // And the element it writes into has to exist, with a live region, or
  // the line changes silently for somebody using a screen reader.
  const html = readPublic('index.html');
  assert.match(html, /id="upd-checked"[^>]*aria-live/,
    'the checked-at line is missing or is not a live region');
});

test('the checked-at line cannot itself go stale on an open pane', () => {
  // A relative time that is wrong is worse than no time at all: a pane
  // left open for half an hour would sit there saying "just now", which is
  // the exact misreading the line exists to prevent. Re-rendered from the
  // payload already in hand, so it costs no fetch and cannot change what
  // the panel claims.
  const js = readPublic('js/admin-updates.js');
  assert.match(js, /setInterval\(\(\) => \{ if \(last\) renderChecked\(last\)/,
    'nothing re-renders the relative time');
  assert.match(js, /title = when\.toLocaleString\(\)/,
    'the absolute time is not available behind the relative one');
});

test('the pane says plainly when the database has not caught up with the code', () => {
  // The invisible fault: a deploy that pulled and did not migrate runs new
  // code against an old schema, every new feature is absent, the version
  // display says the new commit, and nothing reports a problem.
  const js = readPublic('js/admin-updates.js');
  assert.match(js, /database has not caught up/,
    'a deployment running ahead of its schema is not told so');
  assert.match(js, /npm run migrate/, 'it does not say what to do about it');
  // And the opposite direction, which is a DIFFERENT fault with a different
  // fix — migrating would do nothing useful.
  assert.match(js, /older than this/,
    'a checkout older than its database is not reported');
  assert.match(js, /do not migrate/,
    'it offers the wrong remedy for a code-behind-database deployment');
});

test('nothing that computes a fingerprint reads the schema state', () => {
  // Delivery-layer, like every other operations reading. A report must not
  // verify differently because of which migrations a box has run.
  for (const f of ['reportCore.js', 'verify.js', 'chainFile.js', 'snapshot.js']) {
    const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.ok(!src.includes('schemaState'), `${f} reads the schema state`);
  }
});

test('the comparison is stated ONCE, and the doctor reads it', () => {
  // It was stated twice. The doctor had its own copy of
  // "files on disk minus rows in schema_migrations" inline, and
  // src/schemaState.js was written beside it without noticing — two
  // statements of one rule, which drift. The admin pane and the doctor
  // disagreeing about whether a box is migrated is worse than either being
  // wrong alone, because it discredits both.
  const doctor = stripComments(fs.readFileSync(
    new URL('../scripts/doctor.js', import.meta.url), 'utf8'));
  assert.match(doctor, /schemaState/, 'the doctor does not read the one implementation');
  assert.ok(!/FROM schema_migrations/.test(doctor),
    'the doctor has its own copy of the comparison again');

  // One place queries that table, and it is the module whose job it is.
  const owners = ['src/schemaState.js', 'scripts/migrate.js'];
  for (const f of ['src/doctor.js', 'src/routes/admin.js', 'src/updates.js',
    'src/updateCheck.js']) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/FROM schema_migrations/.test(src),
      `${f} queries schema_migrations; ${owners.join(' and ')} are the only two that may`);
  }
});

test('the doctor offers a DIFFERENT fix for each direction of drift', () => {
  // Migrating a deployment whose code is older than its database would do
  // nothing useful, so telling somebody to migrate there is telling them to
  // waste a step and leaves the real fault in place.
  const doctor = stripComments(fs.readFileSync(
    new URL('../scripts/doctor.js', import.meta.url), 'utf8'));
  assert.match(doctor, /npm run migrate/, 'a database behind its code gets no remedy');
  assert.match(doctor, /do NOT migrate/,
    'a checkout older than its database is told to migrate, which does nothing');
});

test('and the database suite runs the drift checks', () => {
  // The two drift cases are the whole point and neither exists without a
  // database, so a unit test cannot cover them.
  const runner = fs.readFileSync(new URL('../scripts/db-selftest.js', import.meta.url), 'utf8');
  assert.match(runner, /schema-state-selftest\.mjs/,
    'nothing runs the schema drift checks');
});


/* ------------------------------------------------------------------ */
group('why a fetch failed, which is not the same as whether it failed');

test('a private remote with no credential is an AUTH failure, not a network one', async () => {
  // THE FAULT THIS FIXES WAS REPORTED FROM A REAL BOX. The pane said "the
  // remote was unreachable just now" for every failure, because the error
  // was thrown away and the sentence was a guess. This repository is
  // private, so a deployment whose service user holds no credential gets an
  // authentication failure and was told it had a network problem — and the
  // wrong answer sends somebody to look at their firewall.
  const { classifyFetchFailure } = await import('../src/updateCheck.js');
  for (const text of [
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    'remote: Repository not found.',
    "fatal: Authentication failed for 'https://github.com/x/y.git/'",
    'git@github.com: Permission denied (publickey).',
  ]) {
    assert.equal(classifyFetchFailure({ stderr: text }), 'auth', text);
  }
});

test('and the other causes are told apart, because the fixes differ', async () => {
  const { classifyFetchFailure } = await import('../src/updateCheck.js');
  assert.equal(classifyFetchFailure({ stderr: 'ssh: Could not resolve hostname github.com' }),
    'dns');
  assert.equal(classifyFetchFailure(
    { stderr: "fatal: unable to access 'https://github.com/': Connection refused" }), 'network');
  assert.equal(classifyFetchFailure({ stderr: 'fatal: not a git repository' }), 'not-a-checkout');
  assert.equal(classifyFetchFailure({ killed: true, signal: 'SIGTERM' }), 'timeout');
  assert.equal(classifyFetchFailure({ stderr: 'something nobody predicted' }), 'unknown');
  assert.equal(classifyFetchFailure(undefined), 'unknown', 'it must not throw on no error at all');
});

test('every cause has a sentence, and an unrecognised one still does', async () => {
  const { classifyFetchFailure, fetchFailureReason } = await import('../src/updateCheck.js');
  for (const cause of ['auth', 'dns', 'network', 'timeout', 'not-a-checkout', 'unknown']) {
    const r = fetchFailureReason(cause);
    assert.ok(typeof r === 'string' && r.length > 20, `${cause} has no usable sentence`);
  }
  // A cause this does not know about must still produce something a person
  // can act on rather than undefined in the pane.
  assert.equal(fetchFailureReason('a-cause-from-the-future'), fetchFailureReason('unknown'));
  assert.ok(classifyFetchFailure({ stderr: '' }));
});

test('the auth sentence names the actual remedy, not a generic one', async () => {
  const { fetchFailureReason } = await import('../src/updateCheck.js');
  const r = fetchFailureReason('auth');
  assert.match(r, /private/, 'it does not say the repository is private');
  assert.match(r, /service user/, 'it does not say WHOSE credential is missing');
  // The token-in-the-URL trap, which clones fine and then breaks updates
  // because update-apply.sh compares the remote against the systemd unit.
  assert.match(r, /remote URL/, 'it does not warn about the token-in-the-URL trap');
});

test("GIT'S OWN OUTPUT NEVER REACHES THE BROWSER, and that is a security property", () => {
  // git's error text can contain the remote URL, and a URL can carry an
  // embedded token — which the install guide explicitly warns people
  // against doing and which some will do anyway. So the response carries a
  // classification and a sentence written in this repository, never
  // anything git said.
  const src = stripComments(fs.readFileSync(
    new URL('../src/updateCheck.js', import.meta.url), 'utf8'));
  // The catch classifies and drops the error; it must not stash the text.
  assert.ok(!/reason:\s*(e|err)\b/.test(src), 'the error itself is used as the reason');
  assert.ok(!/stderr\s*:/.test(src), 'stderr is placed into a returned object');
  assert.ok(!/\bdetail:\s*(e|err)\./.test(src), 'git output is returned as a detail');
  // And the classifier is the only thing that ever looks at it.
  const looks = (src.match(/\.stderr/g) || []).length;
  assert.equal(looks, 1, 'more than one place reads git stderr');
});

test('and the classification is actually WIRED IN, not merely exported', () => {
  // THE VACUOUS PASS THIS CLOSES: the tests above exercise
  // classifyFetchFailure directly, so they stay green if checkForUpdate
  // stops calling it and goes back to a one-size guess. Reverting the wiring
  // tripped only the GIT_TERMINAL_PROMPT check until this existed.
  const src = stripComments(fs.readFileSync(
    new URL('../src/updateCheck.js', import.meta.url), 'utf8'));
  assert.match(src, /fetchCause = classifyFetchFailure\(e\)/,
    'the catch does not classify the error it caught');
  assert.match(src, /reason: fetched \? null : fetchFailureReason\(fetchCause\)/,
    'the reason is not derived from the cause');
  assert.match(src, /fetchCause,/, 'the cause is not returned, so no caller can branch on it');
  // And the sentence it replaced must be gone, or both could coexist with
  // the guess winning.
  assert.ok(!/the remote was unreachable just now/.test(src),
    'the one-size-fits-all guess is still in the file');
});

test('git is never left waiting for a password that cannot be typed', () => {
  // Without GIT_TERMINAL_PROMPT=0 a private remote with no stored
  // credential leaves git trying to read a username from a terminal that
  // does not exist, so every load of the pane waits out the 20-second
  // timeout instead of failing in milliseconds.
  const src = fs.readFileSync(new URL('../src/updateCheck.js', import.meta.url), 'utf8');
  assert.match(src, /GIT_TERMINAL_PROMPT: '0'/,
    'a private remote will hang the pane for the whole fetch timeout');
});


/* ------------------------------------------------------------------ */
group('a private clone, and whose credential it has to be');

/* Prose as a person reads it, not as a file wraps it.

   MATCHING PHRASES IN DOCUMENTS HAS BITTEN THIS SUITE TWICE: once where a
   sentence wrapped across a line in HTML, and once where a markdown
   blockquote put "> " between two words. Both times the guard failed on
   text that was present and correct. So prose checks flatten first —
   blockquote markers, list markers, tags and newlines all become single
   spaces — and the regex is written the way the sentence reads. */
function flatProse(text) {
  return text
    .replace(/<[^>]+>/g, ' ')      // HTML tags
    .replace(/^[>\s]*/gm, ' ')     // markdown blockquote and indent markers
    .replace(/&mdash;|&ndash;/g, '-')
    .replace(/\s+/g, ' ');
}

test('both guides say WHICH USER the stored credential belongs to', () => {
  // THE FAULT THIS CATCHES CAME BACK FROM THE FIRST REAL INSTALL. The note
  // said `git config --global credential.helper store` without saying as
  // whom, and `--global` means PER USER — so the obvious thing, storing it
  // as whoever you are logged in as, leaves the service with nothing and
  // the Updates pane reporting a failure nobody can explain.
  //
  // Every path that touches the remote runs as the service user: the clone
  // (sudo -u), the pane's own check, update-apply.sh (runuser -u), and
  // deploy.sh. Root needs none.
  const install = flatProse(fs.readFileSync(new URL('../INSTALL.md', import.meta.url), 'utf8'));
  const docs = flatProse(readPublic('docs.html'));
  for (const [name, text] of [['INSTALL.md', install], ['docs.html', docs]]) {
    if (!/credential\.helper/.test(text)) continue;
    assert.match(text, /sudo -u reportlog git[\s\S]{0,80}credential\.helper store/,
      `${name} does not show storing the credential AS the service user`);
    assert.match(text, /root needs none/,
      `${name} does not say root needs no credential, which is the other half`);
    // And it must say what the failure looks like, or somebody will read a
    // working deployment as a broken one.
    assert.match(text, /cannot authenticate/,
      `${name} does not name the symptom of a missing credential`);
    assert.match(text, /leave this undone/,
      `${name} does not say this is optional, which it is`);
  }
});

test('a stored token cannot be committed by accident', () => {
  // The service user's home IS the checkout, so a stored credential lands
  // inside the working tree. `git add -A` must not be able to commit it,
  // and `git status` on such a box should not be permanently noisy.
  const ignore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^\.git-credentials$/m, '.git-credentials is not ignored');
  assert.match(ignore, /^\.gitconfig$/m, '.gitconfig is not ignored');
});


/* ------------------------------------------------------------------ */
group('root runs only an updater the application cannot write');

/* THE FAULT, found 10 October by reading the units: reportlog-update.service
   ran /srv/reportlog/contrib/update-apply.sh as root, every minute, and the
   application owns that checkout and has ReadWritePaths over it. So a
   code-execution bug in the web app was root within a minute — the exact
   escalation the design says it prevents. The remote was pinned with care;
   the program reading it was left where an attacker could replace it. No
   check ever asked where root LOADS the script from, only what it does. */

test('the shipped unit runs the root-owned copy, and never anything in the checkout', async () => {
  const { UPDATER_PATH } = await import('../src/doctor.js');
  const unit = fs.readFileSync(new URL('systemd/reportlog-update.service', contribDir), 'utf8');
  const exec = (unit.match(/^ExecStart=(\S+)/m) || [])[1];
  assert.equal(exec, UPDATER_PATH, 'the update unit does not run root\'s copy of the updater');
  assert.ok(!exec.startsWith('/srv/reportlog/'),
    'ROOT RUNS A FILE INSIDE THE CHECKOUT, which the application can write');
});

test('and no root unit runs anything out of the checkout the application owns', () => {
  // Broader than the updater, on purpose: the same mistake on any other
  // root unit is the same escalation. Units that run AS the service user may
  // run its code — that is what they are for.
  const dir = new URL('systemd/', contribDir);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.service'))) {
    const unit = fs.readFileSync(new URL(f, dir), 'utf8');
    if (/^User=(?!root)\S+/m.test(unit)) continue;
    const exec = (unit.match(/^ExecStart=(\S+)/m) || [])[1] || '';
    assert.ok(!exec.startsWith('/srv/reportlog/'),
      `${f} runs as root and executes ${exec}, a file the application can write`);
  }
});

test('install-units.sh puts root\'s copy where the unit looks, owned by root', async () => {
  const { UPDATER_PATH } = await import('../src/doctor.js');
  const sh = fs.readFileSync(new URL('install-units.sh', contribDir), 'utf8');
  const libexec = (sh.match(/^LIBEXEC=(\S+)/m) || [])[1];
  assert.equal(`${libexec}/update-apply.sh`, UPDATER_PATH,
    'install-units.sh and the unit disagree about where the updater lives');
  assert.match(sh, /install -m 755 -o root -g root '\$TMP\/update-apply\.sh' '\$LIBEXEC\/update-apply\.sh'/,
    'the installed updater is not root-owned and closed to everyone else');
  // From the COMMITTED version, read through the checkout's owner — root's
  // git refuses a repository another user owns — and only when the file on
  // disk agrees with it.
  assert.match(sh, /as_owner_git show HEAD:contrib\/update-apply\.sh/,
    'the updater is installed from the working tree rather than the commit');
  assert.match(sh, /as_owner_git diff --quiet HEAD -- contrib\/update-apply\.sh/,
    'an updater edited in the checkout would be installed for root without a word');
});

test('the updater refuses to be a file the application could have written', () => {
  const sh = stripComments(fs.readFileSync(new URL('update-apply.sh', contribDir), 'utf8'));
  assert.match(sh, /running from inside \$REPO/, 'it will run from inside the checkout');
  assert.match(sh, /stat -c %u "\$SELF"/, 'it does not check that root owns it');
  assert.match(sh, /-perm \/022/, 'it does not check that only root can write it');
});

test('and renews itself from the commit it verified, rather than giving up', () => {
  /* IT USED TO GIVE UP, and this test used to assert that. A release that
     changed the updater sent the operator to a shell, which is the last case
     where the admin panel's button could not do the job. It must always
     work. So root renews its own copy and re-runs it.

     THE OLD TEST ROTTED RATHER THAN FAILING, which is why this one is
     written against named behaviour instead of a sentence. It asserted
     `indexOf('this release changes the updater itself') < indexOf(backup)`,
     and once that sentence was deleted indexOf returned -1 — still less than
     anything, so it kept passing over a behaviour that was gone. */
  const sh = stripComments(fs.readFileSync(new URL('update-apply.sh', contribDir), 'utf8'));
  assert.match(sh, /repo_git show "\$TIP:contrib\/update-apply\.sh"[^\n]*cmp -s - "\$SELF"/,
    'the updater does not compare itself with the release it is about to apply');

  const compare = sh.indexOf('cmp -s - "$SELF"');
  const renew = sh.indexOf('REPORTLOG_UPDATER_RENEWED=1 exec "$SELF"');
  const backup = sh.indexOf('npm run --silent backup');
  assert.ok(compare > 0 && renew > compare,
    'the updater never re-runs the copy it renewed');
  assert.ok(renew < backup,
    'the renewal must happen before anything is touched');

  // The content comes out of the verified commit, lands root-owned, and is
  // RENAMED over the running file rather than written into it — bash reads
  // this script from disk as it runs.
  assert.match(sh, /repo_git show "\$TIP:contrib\/update-apply\.sh" > "\$NEW_UPDATER"/,
    'the renewed updater does not come from the commit root verified');
  assert.match(sh, /chown root:root "\$NEW_UPDATER"/,
    'the renewed updater is not made root-owned before it moves');
  assert.match(sh, /mv -f "\$NEW_UPDATER" "\$SELF"/,
    'the renewed updater is written in place rather than renamed over');
  assert.ok(!/\binstall\b[^\n]*"\$SELF"/.test(sh),
    '`install` rewrites the bytes under the running interpreter; use a rename');

  // And once, never twice: a second pass that still disagrees gives up.
  assert.match(sh, /if \[ -n "\$\{REPORTLOG_UPDATER_RENEWED:-\}" \]/,
    'nothing stops a renewal that never matches from re-running forever');
  assert.ok(sh.indexOf('REPORTLOG_UPDATER_RENEWED:-') < renew,
    'the loop breaker is checked after the re-exec, so it never breaks a loop');
});

test('deploy.sh says when a release changed the updater, before it can stop', () => {
  // Run as the service user it stops at the restart when it cannot sudo, so
  // a notice saved for the end would never be seen on exactly the box that
  // needs it.
  const sh = fs.readFileSync(new URL('deploy.sh', contribDir), 'utf8');
  const notice = sh.indexOf('updater_notice\n');
  assert.ok(notice > 0, 'deploy.sh never tells anybody the updater changed');
  assert.ok(notice < sh.indexOf('say "Restarting'),
    'the notice comes after the restart, which a run without sudo never reaches');
});

test('the doctor finds a box still on the old arrangement, and the other faults', async () => {
  const { updaterProblems, UPDATER_PATH } = await import('../src/doctor.js');
  const repoDir = '/srv/reportlog';
  const unit = (exec) => `[Service]\nExecStart=${exec}\n`;
  const good = { exists: true, uid: 0, mode: 0o100755, text: 'same' };

  assert.deepEqual(updaterProblems({ unitText: null, repoDir }), [],
    'no update unit is an optional choice, not a fault');
  assert.match(updaterProblems({ unitText: unit('/srv/reportlog/contrib/update-apply.sh'),
    repoDir, installed: good })[0].problem, /ROOT RUNS THE UPDATER OUT OF THE CHECKOUT/);
  assert.match(updaterProblems({ unitText: unit(UPDATER_PATH), repoDir,
    installed: { exists: false } })[0].problem, /does not exist/);
  assert.match(updaterProblems({ unitText: unit(UPDATER_PATH), repoDir,
    installed: { ...good, uid: 1000 } })[0].problem, /not owned by root/);
  assert.match(updaterProblems({ unitText: unit(UPDATER_PATH), repoDir,
    installed: { ...good, mode: 0o100775 } })[0].problem, /writable by somebody other than root/);
  assert.match(updaterProblems({ unitText: unit(UPDATER_PATH), repoDir,
    installed: good, checkoutText: 'different' })[0].problem, /differs from the checkout/);
  // The updater renews its own copy now, so a stale one is a notice and not a
  // fault that fails the doctor.
  assert.equal(updaterProblems({ unitText: unit(UPDATER_PATH), repoDir,
    installed: good, checkoutText: 'different' })[0].required, false);
  assert.doesNotMatch(updaterProblems({ unitText: unit(UPDATER_PATH), repoDir,
    installed: good, checkoutText: 'different' })[0].problem, /refused/);
  assert.deepEqual(updaterProblems({ unitText: unit(UPDATER_PATH), repoDir,
    installed: good, checkoutText: 'same' }), [], 'a correct install is reported as faulty');
  for (const f of updaterProblems({ unitText: unit('/srv/reportlog/contrib/update-apply.sh'),
    repoDir, installed: good })) {
    assert.match(f.fix, /install-units\.sh/, 'the fault does not name its fix');
  }
});

test('the guides do not repeat the old claim without the reason it now holds', () => {
  // "They could not make it install code of their own" was printed in both
  // guides while it was false. It stays only beside the explanation of why it
  // is true now, and what it still trusts.
  for (const [name, raw] of [
    ['INSTALL.md', fs.readFileSync(new URL('../INSTALL.md', import.meta.url), 'utf8')],
    ['docs.html', readPublic('docs.html')]]) {
    const text = flatProse(raw);
    if (!/could not make it install code of their own/.test(text)) continue;
    assert.match(text, /\/usr\/local\/libexec\/reportlog/,
      `${name} makes the claim without saying where root's updater now lives`);
    assert.match(text, /What it still trusts/,
      `${name} makes the claim without saying what it still trusts`);
    assert.match(text, /A release that changes the updater installs itself anyway/,
      `${name} does not say what happens when a release changes the updater`);
  }
});

/* ------------------------------------------------------------------ */
group('The map');

const mapsJson = JSON.parse(fs.readFileSync(
  new URL('../public/geo/maps.json', import.meta.url), 'utf8'));

test('every area on either plane has a shape and a name', () => {
  for (const plane of ['us', 'world']) {
    for (const [code, a] of Object.entries(mapsJson[plane].areas)) {
      assert.ok(a.name, `${plane} ${code} has no name`);
      assert.ok(Array.isArray(a.polys) && a.polys.length, `${plane} ${code} has no geometry`);
    }
  }
  // AN AREA WITH REPORTS AND NO SHAPE IS A HOLE THAT READS AS A BUG. This
  // is the check that catches a projection silently dropping something —
  // geoAlbersUsa drops all five territories and says nothing.
  for (const t of mapsJson.tiles) {
    assert.ok(t.d && t.d.length > 10, `tile ${t.code} has no path`);
    assert.ok(t.name && t.short, `tile ${t.code} has no name`);
  }
});

test('the fifty states, DC and the seven beyond the lower 48 are all there', () => {
  const have = new Set(Object.keys(mapsJson.us.areas));
  for (const t of mapsJson.tiles) have.add(t.code);
  // 48 contiguous states and DC on the map, plus the seven tiles.
  assert.equal(have.size, 56, `expected 56 US areas, found ${have.size}`);
  for (const c of ['US-AK', 'US-HI', 'US-PR', 'US-VI', 'US-GU', 'US-MP', 'US-AS', 'US-DC']) {
    assert.ok(have.has(c), `${c} is missing`);
  }
});

test('and no tile is a thread nobody could read', () => {
  // One of the three ways a tile looks empty. The third — mostly water —
  // cannot be checked here: Hawaii covers 16% of its tile and reads
  // perfectly, the Virgin Islands covered 19% and did not. Recognisability
  // is a judgement, taken per territory in tools/build-geo.mjs.
  for (const t of mapsJson.tiles) {
    const ratio = t.vb[2] / t.vb[3];
    assert.ok(ratio <= 7 && ratio >= 1 / 7,
      `${t.code} is ${ratio.toFixed(1)}:1 — too long and thin to read as a tile`);
  }
});

test('the map asks for no tile server, ever', () => {
  // A tile request would tell a third party which states the readers of an
  // incident archive are looking at, and every deployment would make it on
  // behalf of an operator who never chose it.
  assert.doesNotMatch(readPublic('js/map.js'), /tileLayer/,
    'public/js/map.js names L.tileLayer');
});

test('the gazetteer and the outlines hold the same places', () => {
  /* EITHER DIRECTION OF DRIFT IS SILENT, which is why this is a test and
     not a comment. A code a form can seal but no map can draw puts reports
     in a place that never appears on any map, and nothing reports a fault —
     the count simply never shows. A code a map can draw but no form can
     seal is an area that is permanently empty, which reads as "nothing
     happened there". tools/build-gazetteer.mjs derives one from the other
     so both are impossible; this is what notices if somebody stops. */
  const gaz = JSON.parse(fs.readFileSync(new URL('../src/data/gazetteer.json', import.meta.url), 'utf8'));
  const maps = JSON.parse(fs.readFileSync(new URL('../public/geo/maps.json', import.meta.url), 'utf8'));

  const drawable = new Set([
    ...Object.keys(maps.us.areas),
    ...maps.tiles.map((t) => t.code),
  ]);
  const named = new Set(Object.keys(gaz.subdivisions.US));
  for (const code of drawable) {
    assert.ok(named.has(code), `the map draws ${code} and no form can seal it`);
  }
  for (const code of named) {
    assert.ok(drawable.has(code), `a form can seal ${code} and no map can draw it`);
  }

  const countries = new Set(Object.keys(maps.world.areas));
  assert.equal(Object.keys(gaz.countries).length, countries.size,
    'the gazetteer and the world plane hold different numbers of countries');
  assert.ok(gaz.countries.US, 'the US subdivisions have no parent country in the gazetteer');
});

test('a location answer is one string, and a name is never taken for a code', () => {
  // It seals the same shape `place` and `short_text` do, so it introduces
  // nothing new into the hashed object — and the absent-key rule applies to
  // it like everything else.
  const scope = { scope: 'us' };
  assert.equal(normalizeAnswer('location', ' us-az ', scope), 'US-AZ',
    'a code is not uppercased, so two browsers would seal two strings');
  assert.equal(normalizeAnswer('location', 'Arizona', scope), null,
    'a place NAME was accepted where a code was meant');
  assert.equal(normalizeAnswer('location', 'US', scope), null,
    'a US-scoped question accepted a bare country');
  assert.equal(normalizeAnswer('location', 'DE', { scope: 'world' }), 'DE');
  assert.equal(normalizeAnswer('location', 'US-AZ', { scope: 'world' }), null,
    'a world-scoped question accepted a subdivision');
  assert.equal(normalizeAnswer('location', '', scope), null);
  assert.equal(typeof normalizeAnswer('location', 'US-AZ', scope), 'string',
    'a location answer is not a plain string');
});

test('a location question is asked with a picker, not a text box', () => {
  /* THE GAP THIS CLOSES, FOUND BY LOOKING RATHER THAN BY A TEST. The type
     was added, the normalizer was added, the gazetteer was built — and the
     form had no branch for it, so the kind fell through to the plain
     `<input type="text">` at the bottom of lbControl. The server takes a
     code and nothing else, deliberately, so that was a question every
     answer to which was refused: a reporter would have had to type `US-AZ`
     to get past it. Nothing errored and no test said a word. */
  const form = readPublic('js/form-logbook.js');
  assert.match(form, /if\(f\.kind==='location'\)\{/,
    'the filing form has no control for a location question, so it draws a text box');
  assert.match(form, /createElement\('select'\)/,
    'the location control is not a picker');

  // The list has to reach the browser, or the picker is an empty select.
  const route = fs.readFileSync(new URL('../src/routes/logbooks.js', import.meta.url), 'utf8');
  assert.match(route, /f\.kind === LOCATION_TYPE \? \{ places: placeOptions/,
    'a location question is sent without the places it offers');
  /* WITH THE QUESTION rather than from a second endpoint, which would have
     meant widening `outsidePass` — the allow-list of what somebody filing
     without the site password may call. */
  const doors = fs.readFileSync(new URL('../src/doors.js', import.meta.url), 'utf8');
  assert.ok(!/places/.test(doors),
    'the gate was widened for a place list that travels with the question anyway');

  // And the reporter checks a NAME before sealing a code they cannot read.
  assert.match(form, /hit\?hit\.name:raw/,
    'the review card shows a place code rather than the place');
});

test('a list may ask a location question, and both sides agree about it', async () => {
  /* THIS TEST ASSERTED THE OPPOSITE until 11 October, and the reason it
     gave was half wrong. It said a list entry has no "moderation status,
     reporter permission, a threshold" — but `list_entries.review_state`
     has existed since migration 046 and its own comment calls it "may
     this be counted", and the threshold was never the row's: it belongs
     to the map. So the real difference is that a list is approved in bulk
     rather than one at a time, which is a weaker claim per row and not a
     reason to refuse the weakest use the data has — a count above a
     threshold.

     WHAT IS ACTUALLY BEING GUARDED, then and now, is that the builder and
     the normalizer agree. A type offered by one and refused by the other
     is a broken form either way round: before, the builder refused and
     the normalizer would have too; now both accept. The failure this
     catches is one of them changing alone. */
  assert.ok(!FORBIDDEN_KINDS.has('location'),
    'the builder refuses a location question that the normalizer accepts');

  const { normalizeValue } = await import('../src/lists/values.js');
  const field = { kind: 'location', options: {} };
  assert.deepEqual(normalizeValue(field, 'US-AZ'), { ok: true, value: 'US-AZ' });
  assert.deepEqual(normalizeValue(field, 'us-az'), { ok: true, value: 'US-AZ' },
    'a list stores a different code from a logbook for the same answer');
  assert.equal(normalizeValue(field, 'Phoenix, Arizona').ok, false,
    'prose is accepted as a place code, so a map would count an area nothing can draw');

  /* THE SAME FUNCTION, NOT A COPY. values.js duplicates part of answers.js
     because answers.js imports the sealing code and the duplication buys
     the guarantee that nothing under src/lists/ can reach it. gazetteer.js
     imports node:fs and nothing else, so a copy of it would buy no
     guarantee and cost a second place for the place codes to drift — and
     two normalizers disagreeing is a map counting an area the form cannot
     offer. */
  const values = fs.readFileSync(new URL('../src/lists/values.js', import.meta.url), 'utf8');
  assert.match(values, /from '\.\.\/gazetteer\.js'/,
    'src/lists/values.js has its own copy of the place codes rather than the one source');

  const { normalizeLocation } = await import('../src/gazetteer.js');
  for (const probe of ['US-AZ', 'us-tx', 'nonsense', 'US']) {
    const viaList = normalizeValue(field, probe);
    const direct = normalizeLocation(probe, {});
    assert.equal(viaList.ok ? viaList.value : null, direct || null,
      `the two sides disagree about ${JSON.stringify(probe)}`);
  }
  /* BLANK IS THE ONE THING THEY ANSWER DIFFERENTLY, and it is right that
     they do. `normalizeValue` returns ok with no value — an unanswered
     optional question is not an error — while `normalizeLocation` has
     nothing to say about a code that is not there. "Not answered" and
     "not a place" are different, and a map skips both. */
  assert.deepEqual(normalizeValue(field, ''), { ok: true, value: undefined },
    'a blank answer to an optional location question is refused as an error');
});

test('a map flag changes no report\'s fingerprint', () => {
  /* THE REASON THE FLAGS ARE COLUMNS AND NOT SETTINGS. `settings` IS in the
     sealed form definition, so marking a launched logbook's question would
     have changed the form hash every one of its reports was sealed against
     — and a logbook that has been collecting for a year is exactly the one
     somebody wants to map. Beside `filterable`, which is excluded for the
     same reason, they rehash nothing. */
  const fields = { key: 'where', kind: 'location', label: 'Where', required: false, settings: {} };
  const plain = formText('book', [fields]);
  const flagged = formText('book', [{
    ...fields, map_location: true, map_outcome: true, filterable: true,
  }]);
  assert.equal(flagged.hash, plain.hash,
    'a map flag changed the form definition, so it rehashes every report of that logbook');

  // And nothing that computes a fingerprint may read the operator's side.
  for (const f of ['reportCore.js', 'verify.js', 'chainFile.js', 'snapshot.js']) {
    const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    for (const forbidden of ['heatMaps.js', 'mapSlots.js', 'homeButtons.js', 'mapData.js']) {
      assert.ok(!src.includes(forbidden), `${f} imports ${forbidden}`);
    }
  }
});

test('the front page\'s accent is a position and not a stored value', () => {
  /* One screen has one main action. The order IS the emphasis, so there is
     no colour to store — and because the accent is computed from the
     position by the one function that resolves the list, an arrangement
     cannot be saved with two accents or none. A per-button colour would be
     a setting whose wrong value nothing can catch: it does not error, it
     just flattens the hierarchy the palette exists to create. */
  const src = fs.readFileSync(new URL('../src/homeButtons.js', import.meta.url), 'utf8');
  assert.match(src, /accent: i === 0/, 'the accent is not derived from the position');
  assert.ok(!/colou?r/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')),
    'the home buttons module has a colour in its code');

  const migration = fs.readFileSync(
    new URL('../migrations/050_home_buttons.sql', import.meta.url), 'utf8',
  );
  assert.match(migration, /ALTER TABLE site_settings ADD COLUMN home_buttons jsonb/,
    'the arrangement is not a single additive column');

  /* An order of kinds and refs, and ONE optional label — nothing else, and
     no colour. The label is an override: blank is stored as no key at all,
     so a button goes on wearing its logbook's or list's own title and
     renaming the logbook renames the button. Two shapes for "no override"
     would be two shapes the read path has to agree about, which is what
     this pins. */
  assert.match(src, /\{ kind: entry\.kind, ref: entry\.ref \}\)/,
    'an arrangement with no label stores something other than a kind and a ref');
  assert.match(src, /\{ kind: entry\.kind, ref: entry\.ref, label \}/,
    'a label is not stored beside the kind and the ref');
  const stored = src.match(/clean\.push\([\s\S]*?\);/);
  assert.ok(stored, 'nothing stores the arrangement');
  for (const key of ['colour', 'color', 'accent', 'href', 'nav']) {
    assert.ok(!new RegExp(key).test(stored[0]),
      `the arrangement stores ${key}, which is not the operator's to set here`);
  }
});

test('a button label is an override, and the site\'s own buttons keep theirs', () => {
  /* A call to action and an archive's title are different sentences —
     "Report a problem at your polling place" against "Election incidents
     2026" — and one string cannot be both without one of them reading
     badly. So the label exists; but it is OPTIONAL and blank by default,
     which is what keeps the old guarantee: nothing drifts from the record's
     own title unless an operator deliberately makes it. */
  const src = fs.readFileSync(new URL('../src/homeButtons.js', import.meta.url), 'utf8');

  // Blank, missing and whitespace are one answer, and that answer is "no
  // override" rather than "a button with no words on it".
  assert.match(src, /e\.label\.trim\(\) \? e\.label\.trim\(\) : null/,
    'a blank label is not read as no override');

  // The fallback, in the one place that resolves the list.
  assert.match(src, /entry\.label && button\.kind !== 'builtin' \? entry\.label : button\.label/,
    'the label does not fall back to the record\'s own title');

  /* THE SITE'S OWN BUTTONS ARE NOT RENAMEABLE. An operator who could
     rewrite "Submit a report" could make the front page lie about what the
     button does, which is the rule the on-page copy editor states too. The
     read path ignores a label on a built-in; the write path REFUSES one,
     so an operator who typed one is told rather than watching it vanish. */
  assert.match(src, /builtin-label/,
    'a label on one of the site\'s own buttons is not refused');
  assert.ok(/label\.length > 80/.test(src), 'a label has no length a button can carry');
});

test('a logbook created after the front page was arranged still appears on it', () => {
  /* THE HALF THAT IS EASY TO LEAVE OUT. Without it, arranging the page once
     quietly opts the operator out of every logbook they make afterwards,
     and nothing tells them — the kind of fault somebody finds months later
     from a reporter asking where the form went. A built-in is deliberately
     NOT appended: an operator who removed the board button meant to. */
  const src = fs.readFileSync(new URL('../src/homeButtons.js', import.meta.url), 'utf8');
  const append = src.slice(src.indexOf('// The append rule'));
  assert.match(append, /available\.logbooks, \.\.\.available\.lists/,
    'nothing is appended, so a new logbook never reaches an arranged front page');
  assert.ok(!/available\.builtins/.test(append.slice(0, 400)),
    'a built-in the operator removed is put back');
});

test('a heat map can exist more than once on a page', () => {
  /* THE SINGLETON THIS REPLACED. Every part of the map's markup was
     addressed by id, which is exactly as many maps as a document can have —
     and worse than a limit, because the second map's code would have found
     the FIRST map's legend and painted the wrong one, silently. An
     operator can now make as many maps as they want (migration 049), so
     this has to stay true. */
  const js = readPublic('js/map.js');
  const html = readPublic('index.html');

  assert.match(html, /<template id="map-template">/,
    'the map markup is not a template, so it can only be in the page once');
  assert.match(html, /data-map="canvas"/,
    'the canvas is not addressed by data-map');
  // Not one id among the map's own parts. `map-template`, the slot
  // containers and the shared hatch are the page's, not an instance's.
  const stageIds = [...html.matchAll(/id="(map-(?:stage|canvas|empty|views|planes|readout|figures|table|tiles|tiles-wrap|ramp-[a-z]+))"/g)];
  assert.equal(stageIds.length, 0,
    `the map still has ids on its own parts: ${stageIds.map((m) => m[1]).join(', ')}`);

  // And the module must not reach for one either.
  assert.doesNotMatch(js, /byId\('map-(stage|canvas|empty|views|planes|readout|figures|table|tiles)/,
    'map.js still looks its own parts up by id, so two maps would share them');
  assert.match(js, /function createInstance\(root, meta\)/,
    'map.js is not built around a per-map instance');
  assert.match(js, /root\.querySelector\('\[data-map="'/,
    'an instance does not scope its lookups to its own root');

  // The outlines are 470 KB. Two maps on a page must cost one download.
  assert.match(js, /if \(geoPromise\) return geoPromise/,
    'the outlines are not shared between maps on a page');
});

test('a map is not fetched until the screen holding it is opened', () => {
  // Leaflet and the outlines are about 600 KB between them and are
  // deliberately not in the service worker's shell. A map on the front page
  // must not load because somebody opened the board, which is why a slot
  // carries which screen it is on rather than just a container.
  const slots = fs.readFileSync(new URL('../src/mapSlots.js', import.meta.url), 'utf8');
  for (const field of ['pane:', 'container:']) {
    assert.match(slots, new RegExp(field), `a slot has no ${field.slice(0, -1)}`);
  }
  const nav = readPublic('js/nav.js');
  assert.match(nav, /renderMapsFor\('dash', which\)/,
    'the board loads maps for every tab rather than the one that opened');
  assert.match(nav, /renderMapsFor\('home'\)/, 'the front page never loads its map');

  // Every slot's container has to be in the page, or a map placed there is
  // a map that silently never appears.
  const html = readPublic('index.html');
  for (const [, id] of slots.matchAll(/container: '([a-z-]+)'/g)) {
    assert.match(html, new RegExp(`id="${id}"`), `no container in the page for slot ${id}`);
  }
});

test('every map has an address, and it is the one the panel names', () => {
  /* THE PANEL PRINTS `/board/map/<slug>` BESIDE EVERY MAP, and for a while
     nothing resolved it — the SPA matched `/board/map` exactly and had no
     pattern for a slug. An operator would have copied the address out of
     the panel and sent somebody to the front page. Found by re-reading the
     claim rather than by a test, which is why there is now one.

     It matters most for a map in the `home` slot: that is the map somebody
     most wants to link to without sending a reader to the front page. */
  const panel = readPublic('js/admin-maps.js');
  const advertised = panel.match(/\/board\/map\/([^'"<]*)/);
  assert.ok(advertised, 'the panel no longer names a map\'s own address');

  const routes = readPublic('js/routes.js');
  assert.match(routes, /\/\^\\\/board\\\/map\\\/\(\[a-z0-9\]/,
    'nothing routes /board/map/<slug>, so the address the panel names does not work');
  assert.match(routes, /showMapNamed\(mMap\[1\]\)/,
    'the address resolves to no map');
  assert.match(readPublic('js/map.js'), /function showMapNamed/,
    'map.js cannot draw a map by name');
});

test('nothing throws the address away at boot', () => {
  /* THE BUG THAT MADE EVERY PREFILTER DO NOTHING, and it was not in the
     prefilter.

     `cardify()` runs for every visitor on every address, before anything is
     routed, and ended with
     `history.replaceState({submitCard:0},'',location.pathname)` — which
     REPLACES the address with its own path and so discards the query
     string of whatever link somebody followed. Nothing noticed for as long
     as nothing read a query. The first feature that did found
     `location.search` already empty, and the symptom was a prefilter that
     quietly did nothing rather than an error.

     So: a history call meaning "same address, new state" has to carry the
     whole address. Any `pushState`/`replaceState` whose URL is bare
     `location.pathname` is that bug again. */
  for (const f of ['form-logbook.js', 'nav.js', 'routes.js', 'list-form.js', 'gate.js']) {
    const src = readPublic(`js/${f}`);
    const bad = [...src.matchAll(/(?:push|replace)State\([^)]*?,\s*''\s*,\s*location\.pathname\s*\)/g)];
    assert.equal(bad.length, 0,
      `${f} rewrites the address as a bare pathname, which drops the query of any link`);
  }
  // And the two that were wrong carry it now.
  const form = readPublic('js/form-logbook.js');
  assert.equal(
    [...form.matchAll(/location\.pathname\+location\.search/g)].length, 2,
    'the two history calls in the card form no longer preserve the query',
  );
});

test('a link can prefilter the board, and can reach nothing a reader could not', () => {
  /* The board built a querystring for its own API since it was written and
     never read one, so a filtered board was reachable by clicking and not
     by sharing. What matters about the new direction is its ceiling: every
     key is one the filter panel already offers, so a link can reach no
     state a reader could not reach by hand. */
  const js = readPublic('js/board.js');
  assert.match(js, /function seedDashFromUrl/, 'the board still ignores its own URL');
  assert.match(js, /renderDash\(\)\{\s*\n\s*seedDashFromUrl\(\);/,
    'the seed does not run before the first render');
  // Checked against the page's own <option>s rather than a list in the
  // module, so the vocabulary cannot drift into a second copy.
  assert.match(js, /function optionExists/,
    'filter values are validated against a list written in the module');

  // AND NO THRESHOLD ANYWHERE NEAR A QUERY PARAMETER. A reader who could
  // lower it could undo the only thing it is for.
  const map = readPublic('js/map.js');
  const q = map.slice(map.indexOf('function applyQuery'), map.indexOf('function ready'));
  assert.doesNotMatch(q, /threshold|min_area/,
    'the map reads a threshold out of the URL');
  for (const key of ['plane', 'view', 'area']) {
    assert.match(q, new RegExp(`get\\('${key}'\\)`), `the map does not accept ?${key}=`);
  }
  assert.match(q, /DATA\.areas\[area\]/,
    'the map would select an area the server withheld a count for');
});

test('map.css names no colour of its own', () => {
  // The same rule client-first.css is held to: every colour is a token, so
  // a palette change reaches the map.
  const css = readPublic('css/map.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'a rule names a hex colour');
  assert.doesNotMatch(css, /\brgba?\(/i, 'a rule names an rgb colour');
  assert.doesNotMatch(css, /:\s*(red|blue|green|black|white|grey|gray)\b/i,
    'a rule names a colour by name');
});

test('the map scales are declared once, not once per palette', () => {
  // Status colour is meaning rather than brand and is the same in every
  // palette. A scale that varied with the operator's palette would make
  // two deployments' maps incomparable.
  const tokens = readPublic('tokens.css');
  for (const n of ['--map-vol-1', '--map-out-5', '--map-sev-3', '--map-nodata']) {
    const hits = [...tokens.matchAll(new RegExp(`${n}\\s*:`, 'g'))].length;
    assert.equal(hits, 1, `${n} is declared ${hits} times — a scale is one set for every palette`);
  }
});

test('an area under the threshold is never sent with its count', () => {
  // THE WHOLE POINT OF THE THRESHOLD. A payload carrying "Wyoming: 1" and
  // a page that politely declines to draw it has still published the
  // number, where a network tab reads it.
  const src = fs.readFileSync(new URL('../src/mapData.js', import.meta.url), 'utf8');
  assert.match(src, /suppressed\.push\(code\)/,
    'the aggregate does not separate suppressed areas out of `areas`');
  assert.doesNotMatch(readPublic('js/map.js'), /r\.n\s*<\s*k/,
    'public/js/map.js decides suppression from a count it should not have');
});

test('a location code rolls up by prefix, because it is one string', () => {
  // The sealed answer is hierarchical, so a state is a prefix of a county
  // and a country is a prefix of a state. No join, no gazetteer lookup.
  assert.equal(areaOf('US-AZ'), 'US-AZ');
  assert.equal(areaOf('US-AZ-013'), 'US-AZ');
  assert.equal(areaOf('DE'), 'DE');
  assert.equal(areaOf(''), null);
  assert.equal(areaOf(undefined), null);
});


/* ---------- one editor open at a time, and one bar for it ---------------- */

test('a panel with a save button becomes an editor; a control stays a control', () => {
  /* The rule is read off the markup rather than listed in a file, so a
     panel added later gets a decided behaviour rather than whichever one
     nobody remembered to choose. A SWITCH IS NOT A FORM: if the
     development notice or "publish this map" needed open/edit/save/close,
     three quick changes would become twelve clicks and the pattern would be
     blamed for being slow when the mistake was applying it where it does
     not belong. */
  const src = readPublic('js/admin-editors.js');
  assert.match(src, /button\[id\$="-save"\]/,
    'the editor test is not "this panel has a save button of its own"');
  assert.match(src, /getAttribute\('data-editor'\) === 'off'/,
    'there is no way to opt a panel out where the test is wrong');

  /* A PANEL WITH TWO SAVES IS TWO FORMS SHARING A CARD, and one bar cannot
     speak for both: the Legal panel holds the imprint and the privacy
     policy, each with its own box and its own button. A bar there would
     save one of them and name neither. */
  assert.match(src, /if \(saves\.length !== 1\) return;/,
    'a panel holding two forms is given one bar for both');

  /* AND THE SCREENS THAT ALREADY WORK THIS WAY ARE LEFT ALONE. The logbook
     builder, the map editor and the list editor are the pattern this
     generalises; wrapping them would hide the list you came to choose
     from behind an Edit button. Declared in the markup, where the next
     person writing a panel will see it. */
  const page = readPublic('index.html');
  for (const id of ['panel-heat-maps', 'panel-logbooks', 'panel-lists', 'panel-ownership',
    /* AND A PANEL THAT RENDERS ITS OWN BODY. The wrapper goes around the
       nodes in the shipped markup, so a renderer replacing innerHTML throws
       it away — and when the Save button arrives with the body, whether the
       panel became an editor at all would depend on whether a fetch had
       answered. */
    'panel-translog']) {
    assert.match(page, new RegExp(`id="${id}" data-editor="off"`),
      `${id} is not opted out, and it is already one-at-a-time`);
  }
});

test('only one editor is open, across the whole screen and not per tab', () => {
  /* A dirty map editor and a dirty site-settings editor at the same time is
     exactly the state this removes, and a per-tab rule would leave it
     reachable by changing tab. One variable holds the open editor; that is
     what makes "is anything unsaved" a single question, which is the only
     thing that makes a warning on navigation possible at all. */
  const src = readPublic('js/admin-editors.js');
  assert.match(src, /var OPEN = null;/, 'the open editor is not a single value');
  assert.match(src, /if \(OPEN && !confirmDiscard\(\)\) return;/,
    'opening a second editor does not ask about the first');
  // Cancel is always offered. A one-at-a-time pattern on a phone is close
  // enough to a modal that it can strand somebody.
  assert.match(src, /id="editor-bar-cancel"/, 'the bar has no Cancel');
  assert.match(src, /e\.key !== 'Escape'/, 'Escape does not get out of an editor');
  // And the bar names what it will save, which was the whole ambiguity.
  assert.match(src, /openEditorName\(\)/, 'the bar does not name what it saves');
});

test('nothing about what a panel saves is copied into the editor', () => {
  // Every one of these panels already had a working save — its own
  // validation, its own endpoint, its own error box. A second copy of any
  // of that would be a second thing to be wrong, so the bar presses the
  // button the panel already has.
  const src = readPublic('js/admin-editors.js');
  assert.match(src, /btn\.click\(\);/, 'the bar does not use the panel\'s own save');
  assert.ok(!/fetch\(/.test(src), 'the editor module talks to the server itself');
  // And a refusal must not shut the panel with the reason inside it.
  assert.match(src, /\.form_error\.on/, 'a save that was refused still closes the editor');
});

test('collapsing a panel is display, and never lazy loading', () => {
  /* EVERY PANE IS IN THE DOM FROM THE FIRST BYTE. That is the gate's
     requirement and not a performance choice: the lock screen is all that
     stands between a visitor and the site's writing. So a collapsed panel
     is `hidden` on a wrapper around nodes that are already there. */
  const src = readPublic('js/admin-editors.js');
  assert.match(src, /body\.appendChild\(node\)/,
    'the collapsed body is rebuilt rather than moved, which drops its listeners');
  assert.ok(!/innerHTML\s*=\s*''/.test(src.replace(/box\.innerHTML/g, '')),
    'something empties a panel instead of hiding it');
  // A closed panel shows its CURRENT VALUES, which is most of the work and
  // the half that makes the other half tolerable.
  assert.match(src, /function paintSummary/, 'a closed panel shows no values');
  // And never the password, which is blank for "keep the current one".
  assert.match(src, /if \(f\.type === 'password'\) return null;/,
    'a summary can print something about the site password');
});

test('leaving with unsaved changes warns first, and the warning can be declined', () => {
  const src = readPublic('js/admin-editors.js');
  assert.match(src, /window\.confirm\(/, 'leaving a dirty editor asks nothing');
  assert.match(src, /will be discarded/, 'the warning does not say what happens');
  assert.match(src, /beforeunload/, 'closing the tab loses the changes silently');
  // The tab strip asks the same question rather than having its own idea of
  // what dirty means.
  assert.match(readPublic('js/admin-look.js'), /if\(!mayLeave\(\)\) return;/,
    'changing tab does not ask about an open editor');
});

test('a control that applies immediately says so, after the server answers', () => {
  /* Part of what was confusing is that some things saved when you touched
     them and some needed a button, and nothing on the screen said which.
     The notification goes in the handler AFTER the answer, never on the
     click — one that appears either way teaches an operator not to believe
     it. */
  assert.match(readPublic('js/admin-settings.js'), /toast\(res\.d\.active \?/,
    'the development notice applies with no notification');
  const maps = readPublic('js/admin-maps.js');
  assert.match(maps, /else toast\('Feed saved\.'\)/,
    'marking a question as a feed applies with no notification, or notifies on a refusal');
  assert.match(readPublic('js/admin-editors.js'), /aria-live', 'polite'/,
    'the notification is not announced, or interrupts like an error');
});

/* ---------- Back moves between tabs, and never past the gate ------------- */

test('the admin tabs push history, and nothing is pushed while gated', () => {
  /* On a phone Back is the primary way people move, so a tab strip that
     touched no history read as the app throwing away their place. THE TRAP
     IS THE GATE: every pane is in the DOM from the first byte, so a history
     entry that routes past the lock screen is a hole. */
  const look = readPublic('js/admin-look.js');
  assert.match(look, /if\(isGated\(\)\) return;/,
    'a history entry can be pushed while the site is locked');
  assert.match(look, /history\.pushState\(\{subnav:/, 'the tabs push no history');
  // The same path: this is a position within a pane, not an address. A real
  // address per tab would be a second router, which is the thing the gate
  // cannot afford.
  assert.match(look, /var path=location\.pathname\+location\.search;/,
    'a tab pushes a new path, which makes the strip a second router');
  /* AND THE ENTRY BEING LEFT IS TAGGED WITH THE SECTION IT IS LEAVING, read
     before show() moves it. Tagged with the new one instead, Back
     "restored" the tab it was already on — which is the same as Back doing
     nothing, and is what the browser suite caught twice. */
  assert.match(look, /var leaving=CURRENT\[navId\];\n      show\(sec\);/,
    'the entry being left is tagged after the move, so Back restores nothing');
  assert.match(look, /if\(!here\.subnav && leaving\)/,
    'the tag does not come from the section being left');
  // Merged, not replaced: that entry may be carrying something else's state.
  assert.match(look, /Object\.assign\(\{\},here,\{subnav:/,
    'tagging an entry throws away whatever state it already had');
  assert.match(look, /if\(sec===CURRENT\[navId\]\) return;/,
    'clicking the open tab piles up history entries that all look the same');
});

test('a subnav history entry is read only after the gate has had its say', () => {
  const routes = readPublic('js/routes.js');
  const gate = routes.indexOf('if(isGated()){');
  const subnav = routes.indexOf('e.state.subnav');
  assert.ok(gate > 0 && subnav > 0, 'the popstate handler no longer has both branches');
  assert.ok(gate < subnav,
    'the subnav branch runs before the gate branch, so a locked page can route');
  // Declining the warning puts the entry back, or Back has already happened
  // and the history is one step out of step with the screen.
  assert.match(routes, /if\(d\.blocked\)\{ history\.pushState\(e\.state/,
    'declining the warning leaves the history out of step with the screen');
});

test('install-units makes the transparency log\'s directory, or the anchor never starts', () => {
  // systemd refuses a unit whose ReadWritePaths names a missing directory,
  // and nothing used to make this one. The path goes through a placeholder
  // because it contains /srv/reportlog, which the next sed rewrites.
  const units = fs.readFileSync(new URL('../contrib/install-units.sh', import.meta.url), 'utf8');
  assert.match(units, /TRANSPARENCY_LOG_DIR=/, 'it does not read the path from .env');
  assert.match(units, /LOG_DIR="\$DIR-transparency-log"/, 'its default disagrees with configure\'s');
  assert.match(units, /install -d -m 755 -o '\$USER_NAME' -g '\$USER_NAME' '\$LOG_DIR'/);
  const first = units.indexOf('s#/srv/reportlog-transparency-log#@@LOG_DIR@@#g');
  assert.ok(first > 0 && first < units.indexOf('-e "s#/srv/reportlog#$DIR#g"'),
    'the log path is rewritten by the checkout substitution');
});

/* ---------- deploy.sh can finish ---------------------------------------- */

test('one sudoers line, so a deploy does not end with a command typed by hand', () => {
  /* deploy.sh runs as the service user and uses sudo for exactly one thing.
     Nothing granted it that, so every deploy of every box ended with a
     person typing the restart. The in-app updater runs AS ROOT from a
     timer, which is why this stayed invisible on the path that matters most
     and bit on the path that is actually used. */
  const units = fs.readFileSync(
    new URL('../contrib/install-units.sh', import.meta.url), 'utf8',
  );
  assert.match(units, /\/etc\/sudoers\.d\/reportlog-restart/,
    'no sudoers dropin is installed');
  // ONE VERB, ONE UNIT, NO WILDCARD. A general grant would hand the
  // application a way to run anything as root and undo the privilege split.
  assert.match(units, /restart reportlog, \$p restart reportlog\.service/,
    'the grant is not one command per spelling of the unit name');
  assert.ok(!/NOPASSWD: *ALL/.test(units), 'the dropin grants everything');
  assert.ok(!/systemctl \*/.test(units), 'the dropin has a wildcard in it');
  // CHECKED BEFORE IT IS INSTALLED: a malformed file in /etc/sudoers.d
  // breaks sudo for everyone on the box, including whoever would fix it.
  assert.match(units, /visudo -cqf/, 'the dropin is installed unchecked');
  assert.match(units, /install -m 440 -o root -g root/,
    'the dropin is not root-owned and read-only');

  /* AND THE PROBE IS THE COMMAND ITSELF. `sudo -n true` is REFUSED on a box
     carrying this grant, so the old probe read a correct configuration as
     "cannot sudo at all" and printed the notice anyway. */
  const deploy = fs.readFileSync(
    new URL('../contrib/deploy.sh', import.meta.url), 'utf8',
  );
  assert.match(deploy, /sudo -n -l systemctl restart "\$SERVICE"/,
    'the restart is gated on a probe that this grant does not satisfy');
});


test('every class on a button is a class some stylesheet defines', () => {
  /* `.btn` WAS DEFINED NOWHERE and was on seven buttons — the Save in the
     editor bar, Apply to the site, Launch this logbook, Accept it, and the
     save in three panels that build their own markup. A class with no rule
     is not a style that is slightly off: the button renders as the
     browser's default, grey and square, next to properly drawn ones. It
     looked deliberate enough that it survived in the markup for months.

     Nothing catches this on its own — there is no build step, a stylesheet
     is not a schema, and a missing rule throws nothing. So it is checked
     here: every class written on a <button> has to appear in a stylesheet
     this page loads. */
  const cssFiles = [
    ...fs.readdirSync(new URL('../public/css/', import.meta.url))
      .filter((f) => f.endsWith('.css')).map((f) => `css/${f}`),
    'client-first.css', 'tokens.css',
  ];
  const css = cssFiles.map((f) => readPublic(f)).join('\n');

  const sources = ['index.html',
    ...fs.readdirSync(new URL('../public/js/', import.meta.url))
      .filter((f) => f.endsWith('.js')).map((f) => `js/${f}`)];

  const missing = new Set();
  for (const file of sources) {
    for (const [, attr] of readPublic(file).matchAll(/<button\b([^>]*)>/g)) {
      const cls = attr.match(/class="([^"]*)"/);
      if (!cls) continue;
      /* A class list built by concatenation — `class="' + cls + '"` — is a
         variable name and a quote, not two classes. Skipped whole: the
         value it ends up with is decided at runtime, and the literal
         flavours it is built from are checked wherever they are written. */
      if (/['`]/.test(cls[1])) continue;
      for (const name of cls[1].split(/\s+/)) {
        if (!name || name.includes('+') || name.includes('$')) continue;
        if (!new RegExp(`\\.${name}\\b`).test(css)) missing.add(`${name} (${file})`);
      }
    }
  }
  assert.deepEqual([...missing], [],
    'these button classes are in no stylesheet, so the browser draws its own button');
});

test('the editor bar outranks the floating buttons, and they lift clear of it', () => {
  /* `.corner` — the development badge, Report a bug, Edit content — is
     fixed to the bottom left at z-index 90, so it drew ON TOP of the bar
     and over its Cancel. Two things claiming the same corner, and the one
     you needed was underneath. */
  const css = readPublic('css/shell.css');
  const barZ = Number((css.match(/\.ed-bar\{[^}]*z-index:(\d+)/) || [])[1]);
  const cornerZ = Number((css.match(/\.corner\{[^}]*z-index:(\d+)/) || [])[1]);
  assert.ok(barZ > cornerZ, `the bar (${barZ}) is under the floating buttons (${cornerZ})`);
  assert.match(css, /body\.has-editor \.corner\{bottom:calc\(var\(--ed-bar-h\)/,
    'the floating buttons do not move out of the bar\'s way');

  /* ONE HEIGHT, NAMED ONCE. The bar, the page's bottom padding, the toast
     and the corner all have to agree about how tall it is; four numbers
     that must match is three chances to be wrong — and the bar wraps to two
     rows on a phone, which is where they would have disagreed. */
  assert.match(css, /--ed-bar-h:\d+px/, 'the bar height is not named once');
  for (const user of [/body\.has-editor\{padding-bottom:calc\(var\(--ed-bar-h\)/,
    /body\.has-editor \.adm-toast\{bottom:calc\(var\(--ed-bar-h\)/]) {
    assert.match(css, user, 'something spaced off the bar carries its own number');
  }
  /* AND THE HEIGHT IS MEASURED, NOT WRITTEN DOWN. It was written down twice
     — 72px, and 104px for a phone on the theory that the bar wraps to two
     rows there. It does not: the name and the two buttons fit on one row,
     so everything spaced off the bar sat about fifty pixels too high and
     the notification floated in the middle of nowhere instead of just above
     it. A guessed height is also wrong the first time the wording is
     longer or somebody's text size is turned up. */
  assert.match(readPublic('js/admin-editors.js'), /setProperty\('--ed-bar-h', h \+ 'px'\)/,
    'the bar does not publish the height it actually is');
  assert.ok(!/@media[^{]*\{[^}]*--ed-bar-h:/.test(css.replace(/\n/g, '')),
    'a stylesheet still guesses the bar height for one screen size');
});

test('the on-screen keyboard does not swallow the bar or the notification', () => {
  /* A BAR FIXED TO THE BOTTOM IS FIXED TO THE BOTTOM OF THE LAYOUT
     VIEWPORT, and the keyboard does not move that. So on a phone the bar
     and the notification went behind the keyboard the moment somebody
     touched the field the bar belongs to — needed exactly then, and not
     scrollable back, because neither is in the scroll. */
  const page = readPublic('index.html');
  assert.match(page, /interactive-widget=resizes-content/,
    'the page is not laid out in what is left of the screen when the keyboard opens');

  /* TWO MECHANISMS, because the meta is not honoured everywhere — iOS
     Safari shrinks the visual viewport and leaves the layout one alone. */
  const js = readPublic('js/admin-editors.js');
  assert.match(js, /window\.visualViewport/, 'nothing measures the keyboard where the meta is ignored');
  assert.match(js, /--kb-inset/, 'the measurement is not published for the stylesheet to use');
  assert.match(js, /Math\.max\(0,/, 'a rubber-band scroll can make the inset negative');

  const css = readPublic('css/shell.css');
  for (const [what, re] of [
    ['the bar', /\.ed-bar\{[^}]*bottom:var\(--kb-inset\)/],
    ['the notification', /\.adm-toast\{[^}]*bottom:calc\(var\(--toast-gap\) \+ var\(--kb-inset\)\)/],
    ['the floating buttons', /body\.has-editor \.corner\{bottom:calc\(.*var\(--kb-inset\)/],
  ]) {
    assert.match(css, re, `${what} does not sit above the keyboard`);
  }
  assert.match(css, /--kb-inset:0px/, 'the inset has no value before anything measures it');

  /* ONE GAP, used twice: the notification floats the same small distance
     off the bottom of the screen and off the top of the bar. Two numbers
     would drift, and the one above the bar is the one nobody sees until a
     bar is open. */
  assert.match(css, /--toast-gap:\d+px/, 'the notification\'s gap is not named once');
  assert.match(css, /body\.has-editor \.adm-toast\{bottom:calc\(var\(--ed-bar-h\) \+ var\(--kb-inset\) \+ var\(--toast-gap\)\)/,
    'the notification does not rest just clear of the bar');

  /* And the FIELD has to clear the bar, not merely clear the keyboard: the
     browser scrolls a focused field just into view by its own reckoning,
     which knows nothing about a bar fixed over the page. */
  assert.match(css, /\.ed-open input[^{]*\{\s*scroll-margin-bottom:calc\(var\(--ed-bar-h\)/,
    'a focused field can land underneath the bar');
});


test('a tile is projected for the place it is drawing, and says what it is', () => {
  /* THE TILES WERE SHEARED. `geoAlbers()` with its rotation overridden
     keeps Albers's parallels — 29.5°N and 45.5°N — and its centre near
     38.7°N, because those are the numbers that draw the United States.
     Guam is at 13°N and American Samoa at 14°S, and a conic projection
     read that far from its parallels shears what it draws. Put the old
     projection back and the build refuses: Alaska alone came out 1.52:1
     where the island is 1.24:1. */
  const geo = fs.readFileSync(new URL('../tools/build-geo.mjs', import.meta.url), 'utf8');
  assert.match(geo, /geoConicEqualArea\(\)\s*\n\s*\.parallels\(\[lat0 \+ span \/ 6, lat1 - span \/ 6\]\)/,
    'a tile is not projected with parallels taken from its own latitude');
  assert.ok(!/const tp = geoAlbers\(\)/.test(geo),
    'a tile is still drawn with the projection meant for the lower 48');

  /* AND IT IS CHECKED RATHER THAN TRUSTED. "Aimed at the place it draws"
     was true of the old projection too, right up until somebody looked at
     Guam, so each tile is projected a second way — azimuthal equal-area
     centred on it, the local truth — and the two must agree. */
  assert.match(geo, /the projection is shearing it/,
    'nothing stops a sheared tile shipping again');
  assert.match(geo, /geoAzimuthalEqualArea\(\)/, 'there is no second opinion to check against');
});

test('a territory tile says what it is, the way the map\'s own areas do', () => {
  /* A tile carried its text in a `title` attribute. That is not the
     tooltip the areas get: the browser draws it, it waits a second on a
     desktop, and ON A PHONE IT NEVER APPEARS — so the territories were the
     one part of the map that said nothing when touched. */
  const js = readPublic('js/map.js');
  assert.ok(!/\.btn\.title = tipFor|btn\.title = tipFor/.test(js),
    'a tile still relies on a title attribute, which a phone never shows');
  assert.match(js, /function showTip\(btn\)/, 'a tile has no tooltip of its own');
  assert.match(js, /setAttribute\('data-tip', tipFor\(/, 'the tooltip has no text to read');
  // Reachable without a pointer, too.
  assert.match(js, /btn\.addEventListener\('focus', function \(\) \{ select\(t\.code\); showTip\(btn\); \}\)/,
    'the tooltip cannot be reached from the keyboard');

  /* FOUND WITHIN THIS MAP, never by id: several maps can be on one page,
     and the rule this whole module is built on is that nothing inside a
     map is addressed by id. */
  assert.ok(!/getElementById\(['"]map-tile-tip/.test(js),
    'the tooltip is found by id, so a second map on the page would steal it');
  assert.match(readPublic('css/map.css'), /\.map-tiles-wrap\{[^}]*position:relative/,
    'the tooltip is positioned against something that is not the panel');
});

test('the selected area is drawn on top of its neighbours', () => {
  /* An SVG path is drawn in document order and its stroke straddles the
     edge, so every neighbour drawn after the selected one painted over the
     inner half of its thicker outline: heavy on some edges, missing on
     others, ragged where three states meet. Nothing was wrong with the
     shape — it was underneath. */
  assert.match(readPublic('js/map.js'),
    /if \(code === state\.sel && l\.bringToFront\) l\.bringToFront\(\);/,
    'the selected outline is left under its neighbours, so it draws ragged');
});


test('a commit id is the same length everywhere somebody reads one', () => {
  /* The Updates pane showed "built from 31df9ef7a26d" while the list of
     commits a few lines above it showed seven characters, because that list
     is `git log --format=%h` and %h is git's own abbreviation. So the pane
     printed two lengths for the same kind of thing, and neither matched
     `git rev-parse --short`, which is what deploy.sh prints as its
     "BEFORE -> AFTER" and what anybody comparing by eye has in a terminal.

     Twelve was deliberate — enough to paste into `git show` with
     confidence — and it lost to the question this line actually exists to
     answer: is the thing I just built the thing that is running. That is
     answered by looking, and looking fails when the two numbers are
     written differently. The whole commit is still in the title. */
  const js = readPublic('js/admin-updates.js');
  assert.match(js, /commit\.slice\(0, 7\)/,
    'the running commit is shown at a length nothing else uses');
  assert.match(js, /title="\$\{esc\(commit\)\}"/,
    'the whole commit is not available for pasting');
  assert.match(fs.readFileSync(new URL('../src/updateCheck.js', import.meta.url), 'utf8'),
    /--format=%h/, 'the commit list no longer uses git\'s own abbreviation');
});


test('a supplied outline is checked against the island it claims to be', () => {
  /* The territories are drawn from supplied SVG now — the national
     boundary file is simplified for drawing a whole country, and a tile is
     the one place a twenty-kilometre island is the entire picture. A
     supplied file is somebody else's work, and "it looked right" is
     precisely how the sheared tiles survived for weeks. */
  const geo = fs.readFileSync(new URL('../tools/build-geo.mjs', import.meta.url), 'utf8');
  assert.match(geo, /not just a different \n?\s*\+? ?`?set of islands/,
    'a supplied outline is used without being checked against the national file');
  /* THE PRINCIPAL ISLAND, not the whole group: two files disagreeing about
     a rock three hundred kilometres away is an inventory difference, and
     measuring the group's extent measures that instead of the shape. */
  assert.match(geo, /const biggest = subs\.reduce/, 'the check is not made against one island');
  assert.match(geo, /off > 0\.05/, 'the tolerance is not stated');
  // And the box is tight to what is drawn: the supplied files are padded,
  // unevenly, and a padded box reads as a small island.
  assert.match(geo, /vb: \[x0, y0, x1 - x0, y1 - y0\]/, 'a tile keeps the supplied padding');

  // Every tile the build emits says where its shape came from.
  const maps = JSON.parse(readPublic('geo/maps.json'));
  const bySource = {};
  for (const t2 of maps.tiles) bySource[t2.source] = (bySource[t2.source] || 0) + 1;
  assert.deepEqual(bySource, { outline: 5, projected: 2 },
    'the tiles are not five supplied outlines and two projected');
  for (const t2 of maps.tiles) {
    assert.ok(t2.d && t2.vb && t2.vb.length === 4, `${t2.usps} has no drawable shape`);
  }
});

await settlePendingTests();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
