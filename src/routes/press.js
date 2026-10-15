/**
 * A deployment's own documents, served as files.
 *
 * These are BUILT AHEAD OF TIME, by whatever the operator uses, and served
 * from disk. Nothing here launches a browser or renders a PDF on request,
 * and it must stay that way: rendering a document on demand is a button any
 * stranger can hold down until the server falls over. As files on disk it is
 * a static download and costs nothing.
 *
 * ReportLog ships no documents and no generator for them — see FILES below.
 * What a deployment publishes is its own choice.
 *
 * No sign-in required. These are the site's public face, and the people most
 * likely to want them are reviewers and press, who are given the site
 * password rather than an account.
 *
 * It still sits behind requireSiteAccess with everything else under /api,
 * so while the site is locked before launch the pack is locked with it.
 * Note the consequence, because it is deliberate rather than overlooked:
 * lifting that lock on launch day publishes this too.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = express.Router();

// The pack ships WITH the release: it is built and committed when a version
// is cut, so `git pull` in the ordinary deploy makes the new one live and
// there is nothing extra to run on the server. Overridable, but nobody
// should have to set it.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRESS_DIR = path.resolve(
  process.env.PRESS_DIR || path.join(HERE, '..', '..', 'press'),
);

// A fixed set of names. The request never contributes to the path — it
// selects one of these — so there is no traversal to get wrong.
//
// Empty by default. WHICH documents a deployment publishes is a property of
// that deployment, not of the software — so ReportLog ships no list, and the
// page honestly renders "nothing built yet" until an operator adds entries.
//
// Each entry is `key: { name, label, blurb, type }`, where `key` is the
// filename inside PRESS_DIR. `version` and `label_note` are optional, for a
// document built outside the release, so the page can say so rather than
// quietly claiming to describe the current site.
const FILES = {
};

function describe() {
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(PRESS_DIR, 'manifest.json'), 'utf8'));
  } catch {
    // No pack built yet, which is a state the page renders rather than an error.
  }
  const files = Object.entries(FILES).map(([key, meta]) => {
    let size = null;
    try {
      size = fs.statSync(path.join(PRESS_DIR, key)).size;
    } catch {
      // Absent files are listed as unavailable rather than hidden: a missing
      // one means the pack was not rebuilt, and that is worth seeing.
    }
    return {
      key,
      name: meta.name,
      label: meta.label,
      blurb: meta.blurb,
      bytes: size,
      // Null means "whatever the pack says". A string means the file carries
      // its own stamp and is not rebuilt with the rest.
      version: meta.version || null,
      note: meta.label_note || null,
    };
  });
  return {
    version: manifest?.version || null,
    commit: manifest?.commit || null,
    built_at: manifest?.built_at || null,
    files,
  };
}

router.get('/', (req, res) => res.json(describe()));

router.get('/:key', (req, res) => {
  const meta = FILES[req.params.key];
  if (!meta) return res.status(404).json({ error: 'No such file' });
  const full = path.join(PRESS_DIR, req.params.key);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: 'That file has not been built yet' });
  }
  // Stamped with the version so a downloaded copy says what it is without
  // being opened.
  const info = describe();
  // A file with its own version is named with it. Stamping the style sheet
  // with the pack's version would put a number on the filename that the
  // document's own cover contradicts.
  const stamped = meta.version || info.version;
  const suffix = stamped ? `-${stamped.replace(/[^A-Za-z0-9.]+/g, '-')}` : '';
  const filename = meta.name.replace(/\.(\w+)$/, `${suffix}.$1`);
  res.setHeader('Content-Type', meta.type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  fs.createReadStream(full).pipe(res);
});

export default router;
