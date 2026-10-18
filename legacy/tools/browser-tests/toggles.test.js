/**
 * Elements the markup starts hidden, on screens nothing else visits.
 *
 * `style="display:none"` became the `hidden` attribute, and the script that
 * shows each element again had to change with it. The failure is silent: a
 * script that still clears style.display leaves the element hidden and throws
 * nothing. `npm test` catches the direct form of it; this drives the screens.
 * Everything is routed, so no account or database state is needed.
 */
import { BASE, Report, open } from './lib.js';

const json = (body) => (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const signedIn = (user) => async (p) => {
  await p.route((u) => u.pathname === '/api/auth/me', json(user));
  await p.route((u) => u.pathname === '/api/me/notifications',
    json({ notify_mode: 'none', notify_logbooks: [] }));
  await p.route((u) => u.pathname === '/api/logbooks',
    json([{ slug: 'polling', title: 'Polling place incidents' }]));
  await p.route((u) => u.pathname === '/api/feedback/counts', json({ open: 0 }));
  await p.route((u) => u.pathname.startsWith('/api/feedback'), json([]));
};
const shown = (page, sel) => page.$eval(sel, (e) => !e.hidden && getComputedStyle(e).display !== 'none');

export default async function run(browser) {
  const r = new Report('hidden-by-default screens');

  // Notifications: "all logbooks" hides the grid, un-ticking shows it.
  {
    const page = await open(browser, `${BASE}/notifications`, { width: 900, height: 900 },
      signedIn({ email: 'reporter@example.org', role: null }));
    await page.waitForTimeout(500);
    r.ok('all logbooks is ticked, so the logbook list is hidden', !(await shown(page, '#notify-logbooks-grid')));
    await page.uncheck('#notify-all-logbooks');
    r.ok('un-ticking it shows the list', await shown(page, '#notify-logbooks-grid'));
    await page.check('#notify-all-logbooks');
    r.ok('ticking it hides the list again', !(await shown(page, '#notify-logbooks-grid')));
    r.ok('no script errors', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }

  // Issues: the filter bar belongs to the admin only.
  for (const [who, role, want] of [['an administrator', 'admin', true], ['a tester', 'access_manager', false]]) {
    const page = await open(browser, `${BASE}/issues`, { width: 900, height: 900 },
      signedIn({ email: 'someone@example.org', role, is_tester: true }));
    await page.waitForTimeout(500);
    r.ok(`the issue filters are ${want ? 'shown to' : 'hidden from'} ${who}`,
      (await shown(page, '#issues-filters')) === want);
    await page.close();
  }

  return r;
}
