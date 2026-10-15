/**
 * The login screen — the first one converted to the Client-First layer.
 *
 * It exists because the conversion changed how the two steps are hidden:
 * an inline `style="display:none"` became the `hidden` attribute, and the
 * JavaScript that shows them again changed to match. Nothing else walks the
 * screen, so a mismatch between the two would ship green. The mail routes are
 * answered here, so no code is sent and nothing is written.
 */
import { BASE, PHONE, Report, open, axeOn } from './lib.js';

export default async function run(browser) {
  const r = new Report('login');
  const page = await open(browser, `${BASE}/login`, PHONE, async (p) => {
    await p.route('**/api/auth/request-code', (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.email === 'bad') {
        return route.fulfill({ status: 400, contentType: 'application/json',
          body: JSON.stringify({ error: 'That does not look like an email address.' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
  });
  const shown = (id) => page.$eval(id, (e) => !e.hidden && getComputedStyle(e).display !== 'none');

  r.ok('the email step is showing and the code step is not',
    await shown('#login-step-email') && !(await shown('#login-step-code')));
  r.ok('the screen carries no inline style',
    (await page.$$eval('#pane-login [style]', (els) => els.length)) === 0);
  r.ok('it is built from the layer, not the old panel classes',
    Boolean(await page.$('#pane-login .container-small .panel_component .form_input'))
    && !(await page.$('#pane-login .panel, #pane-login .go, #pane-login .btn2')));

  await page.fill('#login-email', 'bad');
  await page.click('#login-send-code');
  await page.waitForTimeout(300);
  r.ok('a refusal is written into the error line and announced',
    (await page.$eval('#login-err', (e) => e.classList.contains('is-shown')
      && e.getAttribute('role') === 'alert' && /email address/.test(e.textContent))));
  r.ok('and the email step stays put',
    await shown('#login-step-email') && !(await shown('#login-step-code')));

  await page.fill('#login-email', 'someone@example.org');
  await page.click('#login-send-code');
  await page.waitForTimeout(300);
  r.ok('a sent code swaps the steps',
    !(await shown('#login-step-email')) && await shown('#login-step-code'));
  r.ok('and clears the old error',
    !(await page.$eval('#login-err', (e) => e.classList.contains('is-shown'))));

  await page.click('#login-restart');
  r.ok('"use a different email" swaps them back',
    await shown('#login-step-email') && !(await shown('#login-step-code')));

  // Both steps, so axe sees the second one too.
  await page.fill('#login-email', 'someone@example.org');
  await page.click('#login-send-code');
  await page.waitForTimeout(300);
  const violations = await axeOn(page, '#pane-login');
  r.ok('axe finds nothing on either step', violations.length === 0, violations.join(', '));

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  r.ok('nothing pushes the page sideways on a phone', !overflow);

  r.ok('no script errors', page.pageErrors.length === 0, page.pageErrors.join(' | '));
  await page.close();
  return r;
}
