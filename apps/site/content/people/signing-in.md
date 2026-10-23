---
title: Signing in
description: Email codes, the second factor every role holder proves, when it is asked for again, and what to do when somebody is locked out.
---

## The email code

Nobody has a password. To sign in, a person types their email address and the site emails them a six-digit code, valid for ten minutes. A few wrong codes and that code stops working. The site gives the same answer whether or not the address has an account, so the sign-in page cannot be used to find out who has one.

A session lasts 24 hours for somebody with no role.

## The second factor

Everybody who holds a role (the owner, administrators, Access Managers, moderators, journalists, and anybody in an organization) proves a second factor after the emailed code:

- an **authenticator app** (a six-digit code that changes every 30 seconds; each code is accepted once), or
- a **passkey**, the device's own fingerprint, face or PIN check.

Both are handled by the site itself; no outside service is involved, and there is no SMS. Each person also gets **ten recovery codes**, each usable once. Five wrong second-factor codes lock it for 15 minutes.

Until a session has proved a second factor, the site treats the person as having **no role at all**: no screen and no action needs to ask separately. A session waiting for its second factor lasts 20 minutes; a proved staff session lasts 12 hours.

People manage their own factors under **Account and security** in the menu: add an app or passkeys, make new recovery codes. The last factor cannot be removed.

## Asked again

Some actions ask for the second factor again even in a proved session, and the check then lasts five minutes:

- opening a reporter's details;
- appointing or removing a role or an organization member, and handing the owner's seat over;
- resetting somebody's second factor;
- approving, rejecting or revoking a journalist;
- closing the site to reports, pausing intake, the harder puzzle, and declining in bulk;
- downloading a complete chain file, and backups and exports;
- publishing a new moderator or journalist agreement;
- adding, replacing or removing a look pack;
- deleting your own account, for anybody with a role.

## Locked out

- **Somebody lost their phone and their recovery codes**: the owner resets their second factor from **People and access › Roles**. It clears their app, passkeys and recovery codes and signs them out everywhere; they set a new one up at their next sign-in.
- **The owner is locked out**: nobody on the site can reset the owner. On the server: `sudo reportlog reset-2fa owner@example.org`. Whoever runs it must already hold the server.

Every reset is recorded in the role audit.

The authenticator apps' secrets are encrypted under the server's `TWO_FACTOR_KEY`. If that key is lost or replaced, people set their app up again after signing in with a passkey or a recovery code, or after a reset. Passkeys and recovery codes do not depend on it.
