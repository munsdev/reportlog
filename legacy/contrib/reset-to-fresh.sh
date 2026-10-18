#!/bin/bash
# Put a TEST deployment back to the state a stranger's install starts in, so
# the first-run setup wizard runs again.
#
#   cd /srv/reportlog && sudo ./contrib/reset-to-fresh.sh
#
# AS ROOT, because it has to stop the service before it drops the schema, and
# the service user's sudo grant covers a restart and nothing else. Run as that
# user it used to print "(not running)" when the stop was refused and carry
# on dropping the schema underneath a running server. It now refuses instead,
# before anything is changed.
#
# THIS DESTROYS THE ARCHIVE ON THIS BOX. Every report, every account, every
# organization, every invitation, and the curtain password. It exists because
# every report on a test box is a test report and there are good reasons to
# start over — a wording change, a schema change, or wanting an instance
# where everything has been through the current code.
#
# IT IS NOT FOR A DEPLOYMENT THAT HAS TAKEN A REAL REPORT. There the answer
# is the tombstone — the row stays, the content is emptied, and the removal
# is itself an appended, published record — and it does not exist yet. Do not
# reach for this instead.
#
# WHAT IT DOES NOT TOUCH: .env. Every credential worth keeping lives there
# and not in the database — the mail keys, the storage keys, and the two
# irreplaceable encryption keys. Nothing here rewrites it, and `npm run
# configure` is deliberately NOT part of this: it would generate new
# encryption keys, which against a database that still had data would be the
# one irreversible mistake available here.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${REPORTLOG_SERVICE:-reportlog}"
cd "$REPO" || exit 1

# Root runs it directly; anybody else needs sudo that does not prompt, since a
# password prompt halfway through a destructive script is a bad place to be.
as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo -n "$@"; fi; }
# And the database work runs as whoever owns the checkout, root or not: a
# DATABASE_URL that uses peer authentication only works as that user, and
# npm should not leave root-owned files in somebody else's tree.
OWNER="$(stat -c %U "$REPO" 2>/dev/null || echo "$(id -un)")"
as_owner() {
  if [ "$(id -u)" = 0 ] && [ "$OWNER" != root ]; then runuser -u "$OWNER" -- "$@"; else "$@"; fi
}
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n%s\n\n' "REFUSED: $*" >&2; exit 1; }

[ -f .env ] || fail "no .env here, so there is nothing configured to reset."
DB=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)
ORIGIN=$(grep -E '^SITE_ORIGIN=' .env | cut -d= -f2- | tr -d '[:space:]')
[ -n "$DB" ] || fail "no DATABASE_URL in .env."
[ -n "$ORIGIN" ] || fail "no SITE_ORIGIN in .env, so I cannot tell you which site this is."

command -v psql >/dev/null 2>&1 || fail "psql is not on PATH; this needs it."

say "Reset to fresh — $ORIGIN"

# --- say exactly what is about to be destroyed, counted from the box --
# Not "this will delete your data". The actual numbers, read now, because a
# warning somebody cannot check is a warning they learn to click past.
read -r REPORTS USERS ORGS INVITES SETUPDONE <<<"$(as_owner psql "$DB" -tA -F' ' -c "
  SELECT
    (SELECT count(*) FROM reports),
    (SELECT count(*) FROM users),
    (SELECT count(*) FROM organizations),
    (SELECT count(*) FROM organization_invites),
    (SELECT coalesce(setup_completed_at::text, 'never') FROM site_settings WHERE id = true);
" 2>/dev/null)" || fail "could not read the database at DATABASE_URL."

echo "  reports        $REPORTS"
echo "  accounts       $USERS"
echo "  organizations  $ORGS"
echo "  invitations    $INVITES"
echo "  setup done     $SETUPDONE"
echo
echo "  All of that goes. .env, nginx, TLS and the systemd units stay."
echo "  Objects already in the evidence and rendition buckets stay too, with"
echo "  no rows pointing at them — harmless on a test box, and worth knowing"
echo "  before somebody counts objects and wonders."

# --- the guard -------------------------------------------------------
# Typing the site's own origin, like a repository name before a delete. It
# is the only confirmation that cannot be given by reflex, and the only one
# that catches the real mistake: running this on the wrong box.
echo
echo "  To confirm, type this deployment's SITE_ORIGIN exactly:"
echo "      $ORIGIN"
printf '  > '
read -r TYPED
[ "$TYPED" = "$ORIGIN" ] || fail "that did not match. Nothing was changed."

# --- do it -----------------------------------------------------------
say "Stopping $SERVICE"
# Every timer that is running now is stopped, and exactly those are started
# again at the end. A fixed list of what to restart once left the anchor
# stopped for good after a reset.
STOPPED_TIMERS=()
if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet "$SERVICE"; then
    as_root systemctl stop "$SERVICE" \
      || fail "could not stop $SERVICE, so nothing has been changed. Run this as root: sudo $0"
    echo "  stopped"
  else
    echo "  (not running, or not managed by systemd here)"
  fi
  # The media worker runs on a timer and would wake into a missing schema;
  # the anchor and the sweep would too.
  for t in reportlog-media-worker.timer reportlog-anchor.timer reportlog-sweep.timer; do
    if systemctl is-active --quiet "$t"; then
      as_root systemctl stop "$t" || fail "could not stop $t. Nothing has been changed; start $SERVICE again yourself."
      STOPPED_TIMERS+=("$t")
      echo "  stopped $t"
    fi
  done
else
  echo "  No systemctl. Stop the app yourself before continuing."
fi

say "Rebuilding the schema"
# DROP SCHEMA rather than dropping the database: it needs no CREATEDB right,
# it keeps ownership, and there are no extensions to lose — checked, no
# migration issues a CREATE EXTENSION. It takes the migration-tracking table
# with it, which is the point: every migration re-runs from scratch.
as_owner psql "$DB" -q -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' \
  || fail "could not rebuild the schema. Nothing else has been done; the service is stopped."
echo "  schema dropped and recreated"

as_owner npm run migrate 2>&1 | sed 's/^/  /' || fail "migrations failed against the empty schema."

# --- the way back in -------------------------------------------------
say "Setting the curtain password"
echo "  The site is now gated with NO password, which means nobody can reach"
echo "  it — including you. This is the step that fixes that."
echo
as_owner npm run --silent set-curtain-password || fail "no curtain password set. The deployment is unreachable until you run: npm run set-curtain-password"

say "Starting $SERVICE"
if command -v systemctl >/dev/null 2>&1; then
  as_root systemctl start "$SERVICE" && echo "  started" || echo "  could not start it; do it yourself"
  for t in "${STOPPED_TIMERS[@]}"; do
    as_root systemctl start "$t" && echo "  started $t" || echo "  could not start $t; do it yourself"
  done
fi

# --- prove the wizard is armed, rather than assuming -----------------
say "Is the wizard armed?"
read -r GATED WIZARD <<<"$(as_owner psql "$DB" -tA -F' ' -c \
  "SELECT access_enabled, setup_completed_at IS NULL FROM site_settings WHERE id = true;" 2>/dev/null)"
echo "  gate on            $GATED   (wants t)"
echo "  wizard will show   $WIZARD   (wants t)"

if [ "$GATED" = "t" ] && [ "$WIZARD" = "t" ]; then
  say "Ready. Open $ORIGIN, enter the curtain password, and the wizard runs."
else
  fail "the gate or the wizard flag is not what it should be. Check site_settings."
fi
