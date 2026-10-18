// The oldest Node this runs on, enforced at boot rather than only reported.
//
// INSTALL.md said the app "refuses to start" below the version in
// package.json, and nothing did: only `npm run doctor` looked. An older Node
// then failed somewhere later, on whichever newer API it reached first, with
// an error that names that API and not the version. So the server imports
// this FIRST — an ES module's imports run in order, so this throws before any
// other module of ours has run.
//
// It cannot catch a Node so old that it fails to PARSE one of our modules;
// that happens before anything runs. In practice the versions people have
// (a distribution's 18 or 20) parse fine and fail at runtime, which is the
// case this is for.
import fs from 'node:fs';
import { nodeVersionOk } from './doctor.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const v = nodeVersionOk(process.version, pkg.engines.node);
if (!v.ok) {
  throw new Error(`This needs Node ${v.min} or newer, and this is Node ${v.have} (${process.execPath}). `
    + 'Install a newer one — INSTALL.md §3.2 — and start it again.');
}
