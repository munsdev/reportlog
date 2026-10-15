/**
 * The accept screen, in a browser.
 *
 * The permission logic is asserted against a real database by
 * scripts/invitations-selftest.mjs — the ceiling, the single use, the wrong
 * account, the limits. What only exists on screen is the thing the spec
 * cares most about:
 *
 *   It must say exactly what is being accepted, before there is anything to
 *   press. Nobody should discover, after clicking a link in an email, that
 *   they can now read restricted material.
 *
 * So these check that the organization, the role, who invited them, and
 * what the role CAN and CANNOT do are all on the page — and that the accept
 * button is not even offered to somebody who is not the invited person.
 */
import { BASE, Report } from './lib.js';

const INVITATION = {
  email: 'invited@example.org',
  role: 'coordinator',
  organization: 'Example Coalition',
  invitedBy: 'manager@example.org',
  expiresAt: '2026-09-25T00:00:00Z',
  permissions: {
    label: 'Coordinator',
    can: [
      'File reports under this organization’s name, including in batches from paper.',
      'See the reports they have filed for it.',
    ],
    cannot: [
      'Add or remove anybody.',
      'Change how the organization appears, or whether it is listed publicly.',
      'See anything about reports filed by anyone else.',
    ],
  },
};

const json = (status, body) => (route) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

async function openInvitation(browser, { user, invitation = INVITATION, status = 200 }) {
  const page = await browser.newPage({ viewport: { width: 420, height: 950 } });
  await page.route('**://*.google*/**', (r) => r.abort());
  await page.route('**://*.gstatic.com/**', (r) => r.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/api/auth/me', (route) => (user
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
    : route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })));
  await page.route('**/api/invitations/*', json(status, invitation));
  await page.goto(`${BASE}/invitation/sometoken`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  page.errors = errors;
  return page;
}

const shown = (page, sel) => page.$eval(sel, (e) => e.offsetParent !== null);
const user = (email) => ({ id: '9', email, role: 'user', is_tester: false, memberships: [] });

export default async function run(browser) {
  const r = new Report('accepting an invitation');

  /* ---- it says what is being accepted ------------------------------- */
  {
    const page = await openInvitation(browser, { user: user(INVITATION.email) });

    r.ok('the invitation opens from its link', await shown(page, '#inv-body'));
    r.ok('and names the organization',
      ((await page.textContent('#inv-org')) || '').includes('Example Coalition'));

    const who = (await page.textContent('#inv-who')) || '';
    r.ok('and who invited them', who.includes('manager@example.org'), who);
    r.ok('and which address was invited', who.includes('invited@example.org'), who);
    r.ok('and which role', /coordinator/i.test(who), who);

    // The part that matters: both halves, not just the flattering one.
    const can = await page.$$eval('#inv-can li', (els) => els.map((e) => e.textContent));
    const cannot = await page.$$eval('#inv-cannot li', (els) => els.map((e) => e.textContent));
    r.ok('it lists what the role can do', can.length === 2, JSON.stringify(can));
    r.ok('and what it cannot', cannot.length === 3, JSON.stringify(cannot));
    r.ok('including that they cannot see other people’s reports',
      cannot.some((x) => /filed by anyone else/i.test(x)), JSON.stringify(cannot));

    const expiry = (await page.textContent('#inv-expiry')) || '';
    r.ok('and when the link stops working', /2026/.test(expiry), expiry);

    r.ok('the invited person is offered the button', await shown(page, '#inv-accept-box'));
    r.ok('and is not asked to sign in again', !(await shown(page, '#inv-signin')));
    r.ok('no uncaught errors on the invitation', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  /* ---- not signed in ------------------------------------------------ */
  {
    const page = await openInvitation(browser, { user: null });
    r.ok('somebody not signed in still sees what it offers', await shown(page, '#inv-body'));
    r.ok('but is not offered the accept button', !(await shown(page, '#inv-accept-box')));
    const text = (await page.textContent('#inv-signin-text')) || '';
    r.ok('and is told which address to sign in as',
      text.includes('invited@example.org'), text);
    await page.close();
  }

  /* ---- signed in as somebody else ----------------------------------- */
  {
    // A forwarded email must not become somebody else's membership. Saying
    // so here beats letting them press Accept and be refused.
    const page = await openInvitation(browser, { user: user('someone.else@example.org') });
    r.ok('the wrong person is not offered the button', !(await shown(page, '#inv-accept-box')));
    const text = (await page.textContent('#inv-signin-text')) || '';
    r.ok('and is told both addresses, so they can tell what is wrong',
      text.includes('invited@example.org') && text.includes('someone.else@example.org'), text);
    await page.close();
  }

  /* ---- a dead link --------------------------------------------------- */
  {
    const page = await openInvitation(browser, {
      user: user(INVITATION.email), status: 404,
      invitation: { error: 'This invitation is not valid any more. It may have been used, withdrawn, or simply expired — ask whoever invited you to send another.' },
    });
    r.ok('a dead link says so', await shown(page, '#inv-bad'));
    r.ok('without offering anything to press', !(await shown(page, '#inv-body')));
    const text = (await page.textContent('#inv-bad-text')) || '';
    // One answer for used, withdrawn, expired and never-existed: the reader
    // can do nothing different in any of them, and separating them would
    // tell a stranger which tokens were once real.
    r.ok('and does not say which of the reasons it was',
      /used, withdrawn, or simply expired/.test(text), text);
    await page.close();
  }

  return r;
}
