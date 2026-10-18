/* boot.js — The one line that starts everything, after every declaration
 * above it exists.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { checkSiteAccess } from './gate.js';

checkSiteAccess();

