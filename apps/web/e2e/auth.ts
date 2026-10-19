import { fileURLToPath } from 'node:url';

/** The signed-in administrator's session, saved by staff.setup.ts. */
export const ADMIN = fileURLToPath(new URL('./.auth/admin.json', import.meta.url));

/** A signed-in moderator's session (not an administrator), saved by staff.setup.ts. */
export const MODERATOR = fileURLToPath(new URL('./.auth/moderator.json', import.meta.url));
