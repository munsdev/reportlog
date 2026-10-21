/**
 * The ALTCHA widget, loaded only by a page with a form on it (useDoor.tsx).
 *
 * THE EXTERNAL BUILD, NOT THE DEFAULT ONE. The default bundle starts its
 * workers from inline blobs, which this site's content security policy
 * (`default-src 'self'`) refuses, as it should. The external build takes its
 * workers from us: Vite emits the PBKDF2 worker as a file of this site's own,
 * and nothing is fetched from anywhere else (e2e/third-party.spec.ts).
 *
 * Only PBKDF2/SHA-256 is registered, because it is the only algorithm the
 * server issues (apps/api/src/door/puzzle.ts).
 */
import 'altcha/external';
import 'altcha/altcha.css';
import Pbkdf2Worker from 'altcha/workers/pbkdf2?worker';

globalThis.$altcha.algorithms.set('PBKDF2/SHA-256', () => new Pbkdf2Worker());
