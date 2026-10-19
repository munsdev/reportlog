import { fileURLToPath } from 'node:url';

/**
 * What the stand-in for Bugsink received in the browser suite, a line of
 * JSON per request (apps/api/test/stand-in-bugsink.ts writes it).
 */
export const BUGSINK_RECEIVED = fileURLToPath(new URL('./.bugsink.jsonl', import.meta.url));
export const BUGSINK_PORT = '3999';
