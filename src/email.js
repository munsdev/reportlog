/**
 * Sending mail, over whichever transport this deployment has.
 *
 * WHY MORE THAN ONE. This file used to talk only to Scaleway's HTTP API,
 * which meant the software could only be installed by somebody with a
 * Scaleway account — and mail is not optional here. Without it nobody can
 * confirm a report, and the one-time sign-in code reaches only the service
 * log, where nobody without a shell on the box will ever see it. One
 * provider's API in one file was the single thing tying this to one
 * person's accounts.
 *
 * SMTP is the portable answer: it works with Postmark, Mailgun, SES,
 * Migadu, Fastmail, a Postfix somebody already runs, and whatever the
 * operator's own host offers. Scaleway stays because a deployment already
 * uses it and there is no reason to break that.
 *
 * THE CONTRACT CALLERS DEPEND ON. `sendEmail` returns `{ sent, reason }`,
 * and six callers test `reason === 'no-api-key'` to decide whether to log a
 * sign-in code that could not be emailed. That string is load-bearing: it
 * means "this deployment cannot send mail at all", and it must keep meaning
 * exactly that whatever transport is chosen.
 */
import nodemailer from 'nodemailer';
import { plainSiteName } from './siteIdentity.js';
import { cleanTyped } from './lineEdit.js';

const SCALEWAY_REGION = process.env.SCALEWAY_REGION || 'fr-par';

/**
 * Which transport, and why that one.
 *
 * `EMAIL_TRANSPORT` is honoured when set, so an operator can force a
 * choice — including forcing `log` on a staging box that must never send
 * real mail. Otherwise it is inferred from what is configured, SMTP first
 * because it is the one somebody self-hosting is most likely to have.
 */
export function transportFor(env) {
  const forced = String(env.EMAIL_TRANSPORT || '').trim().toLowerCase();
  if (forced === 'smtp' || forced === 'scaleway' || forced === 'log') return forced;

  if (env.SMTP_HOST) return 'smtp';
  if (env.SCALEWAY_SECRET_KEY && env.SCALEWAY_PROJECT_ID) return 'scaleway';
  return 'log';
}

export const emailTransport = () => transportFor(process.env);

/**
 * What a given configuration is missing, without consulting the live
 * environment. The installer and the doctor both need to ask this about a
 * `.env` they have just read or are about to write, and neither is running
 * inside the deployment being described.
 */
export function readinessFor(env) {
  const transport = transportFor(env);
  const has = (k) => Boolean(String(env[k] ?? '').trim());

  if (transport === 'log') {
    return { ok: false, transport, missing: ['SMTP_HOST or SCALEWAY_SECRET_KEY'] };
  }
  const missing = [];
  if (!has('ALERT_FROM_EMAIL')) missing.push('ALERT_FROM_EMAIL');
  if (transport === 'smtp') {
    if (!has('SMTP_HOST')) missing.push('SMTP_HOST');
    // A password is not required — an internal relay on localhost often
    // takes unauthenticated submission — but a user without one is a
    // half-finished answer rather than a deliberate choice.
    if (has('SMTP_USER') && !has('SMTP_PASS')) missing.push('SMTP_PASS');
  }
  if (transport === 'scaleway') {
    if (!has('SCALEWAY_SECRET_KEY')) missing.push('SCALEWAY_SECRET_KEY');
    if (!has('SCALEWAY_PROJECT_ID')) missing.push('SCALEWAY_PROJECT_ID');
  }
  return { ok: missing.length === 0, transport, missing };
}

/** Everything about how mail would be sent, without sending any. */
export function emailConfig() {
  const transport = emailTransport();
  return {
    transport,
    from: {
      email: process.env.ALERT_FROM_EMAIL || '',
      // CLEANED, because the install prompt once saved the arrow keys pressed
      // while typing this, and every email went out from "Test Log 2 [D [D…".
      // Replaying them gives what was on screen. src/lineEdit.js.
      name: cleanTyped(process.env.ALERT_FROM_NAME || '').trim() || 'ReportLog',
    },
    smtp: {
      host: process.env.SMTP_HOST || '',
      // 587 is submission with STARTTLS and is what most providers want.
      port: Number(process.env.SMTP_PORT || 587),
      user: process.env.SMTP_USER || '',
      // Implicit TLS on 465, STARTTLS everywhere else. Derived rather than
      // asked, because getting it wrong is the most common SMTP
      // misconfiguration and the port already says which one it is.
      secure: process.env.SMTP_SECURE
        ? process.env.SMTP_SECURE === 'true'
        : Number(process.env.SMTP_PORT || 587) === 465,
      hasPassword: Boolean(process.env.SMTP_PASS),
    },
    scaleway: {
      region: SCALEWAY_REGION,
      hasKey: Boolean(process.env.SCALEWAY_SECRET_KEY),
      hasProject: Boolean(process.env.SCALEWAY_PROJECT_ID),
    },
  };
}

/**
 * Is this deployment able to send at all, and if not, what is missing?
 *
 * Separate from sending so the doctor and the configure script can ask
 * without a message to send. A transport that is half-configured is
 * reported as unable rather than as ready: half-filled SMTP looks set in a
 * file and fails at the first send.
 */
export const emailReadiness = () => readinessFor(process.env);

// One connection pool for the life of the process. Built lazily so nothing
// is opened on a deployment that never sends, and rebuilt if the config
// changes underneath it, which only happens in tests.
let cachedTransport = null;
let cachedKey = '';

function smtpTransport(c) {
  const key = JSON.stringify([c.smtp.host, c.smtp.port, c.smtp.user, c.smtp.secure]);
  if (cachedTransport && cachedKey === key) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: c.smtp.host,
    port: c.smtp.port,
    secure: c.smtp.secure,
    auth: c.smtp.user ? { user: c.smtp.user, pass: process.env.SMTP_PASS } : undefined,
    // A slow or wedged mail server must not hold a request open: every
    // caller here is inside an HTTP handler somebody is waiting on.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  cachedKey = key;
  return cachedTransport;
}

export function resetEmailTransport() {
  cachedTransport = null;
  cachedKey = '';
}

/** Plain text from html, for the multipart alternative. */
const textFrom = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function sendViaSmtp({ to, subject, html, text }, c) {
  try {
    await smtpTransport(c).sendMail({
      from: c.from.name ? `"${c.from.name}" <${c.from.email}>` : c.from.email,
      to: to.map((t) => t.email).join(', '),
      subject,
      html,
      text: text || textFrom(html),
    });
    return { sent: true };
  } catch (e) {
    // The address is never logged with the failure. A bounce log that
    // pairs "who" with "what went wrong" is a contact list.
    console.error(`[email] SMTP send failed: ${e.message}`);
    return { sent: false, reason: 'smtp-failed' };
  }
}

async function sendViaScaleway({ to, subject, html, text }, c) {
  const res = await fetch(
    `https://api.scaleway.com/transactional-email/v1alpha1/regions/${c.scaleway.region}/emails`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Auth-Token': process.env.SCALEWAY_SECRET_KEY,
      },
      body: JSON.stringify({
        from: { name: c.from.name, email: c.from.email },
        to,
        subject,
        html,
        text: text || textFrom(html),
        project_id: process.env.SCALEWAY_PROJECT_ID,
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[email] Scaleway send failed: ${res.status} ${body}`);
    return { sent: false, reason: `http-${res.status}` };
  }
  return { sent: true };
}

export async function sendEmail({ to, subject, html, text }) {
  const c = emailConfig();

  // An operator who never set ALERT_FROM_NAME was sending mail FROM
  // "ReportLog" — the software introducing itself in the inbox of somebody
  // who has only ever heard of the deployment. The env var still wins where
  // it is set, because a sender name sometimes has to match what the mail
  // provider has verified; the site's own name is the better default behind
  // it, and the software's name remains the last resort inside plainSiteName.
  if (!cleanTyped(process.env.ALERT_FROM_NAME || '').trim()) {
    c.from = { ...c.from, name: await plainSiteName() };
  }

  if (c.transport === 'log') {
    // Subject and recipient only. The BODY IS DISCARDED ON PURPOSE — it
    // carries one-time codes and confirmation links, and a log is the wrong
    // place for either. Callers that need the code on an unconfigured
    // deployment log it themselves, deliberately and per route.
    console.log(`[email:pending-key] would send "${subject}" to ${to.map((t) => t.email).join(', ')}`);
    return { sent: false, reason: 'no-api-key' };
  }

  if (c.transport === 'smtp') return sendViaSmtp({ to, subject, html, text }, c);
  return sendViaScaleway({ to, subject, html, text }, c);
}
