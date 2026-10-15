#!/bin/bash
# Runs when a Claude Code session opens in this repo. Whatever it prints is
# put in front of the session before the first message.
#
# It carries the facts that GO STALE — what is deployed, what branch this is,
# what is running on this box. Those must never live in a checked-in file,
# because a file that states a moving fact starts lying the moment it is
# written. Everything durable is in CLAUDE.md and CONTRIBUTING.md.
#
# This exists because a session once reported six undeployed releases from
# its own notes taken an hour earlier, when production was in fact current.
# One curl would have prevented it.
#
# Must stay fast and must never fail the session — every step is allowed to
# fail quietly. Idempotent: nothing here changes state except installing
# dependencies that are missing.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

# --- dependencies, only when absent -----------------------------------------
# A fresh clone has none. A warm container has them all and skips this.
[ -d node_modules ] || npm install --no-audit --no-fund >/dev/null 2>&1
[ -d tools/browser-tests/node_modules ] || \
  (cd tools/browser-tests && npm install --no-audit --no-fund >/dev/null 2>&1)

# --- the briefing -----------------------------------------------------------
echo "=== ReportLog · session briefing =================================="
echo

# THE DEPLOYMENTS. None by default: set REPORTLOG_DEPLOYMENTS, space-separated
# hostnames, and each is asked which version it is running. They are gated,
# so the useful answer is that one is answering at all and what it says.
#
# NO ANSWER IS NOT THE SAME AS DOWN, and the wording keeps them apart: a box
# that does not exist yet, a name with no DNS, a box that is broken, AND an
# environment whose network policy does not allow the host all curl the same
# way from here. Only one of those four is news about the deployment.
for HOST in ${REPORTLOG_DEPLOYMENTS:-}; do
  SHORT=${HOST%%.*}
  LIVE=$(curl -s --max-time 6 "https://$HOST/api/site-access/status" 2>/dev/null)
  if [ -n "$LIVE" ]; then
    echo "$SHORT  $LIVE"
  else
    echo "$SHORT  no answer — may not exist yet, or may be down. Check before asserting either"
  fi
done

LOCAL_VER=$(node -p "require('./package.json').version" 2>/dev/null || echo '?')
echo "WORKING TREE  package.json says $LOCAL_VER"

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
echo "BRANCH  $BRANCH"

git fetch --quiet origin main 2>/dev/null
AHEAD=$(git rev-list --count origin/main..main 2>/dev/null || echo '?')
BEHIND=$(git rev-list --count main..origin/main 2>/dev/null || echo '?')
echo "MAIN  $AHEAD ahead of origin, $BEHIND behind"

DIRTY=$(git status --porcelain 2>/dev/null | wc -l)
[ "$DIRTY" -gt 0 ] && echo "UNCOMMITTED  $DIRTY file(s) — someone may have left work behind"

# The development cluster listens on a socket in /tmp/pgrun, not on TCP, so
# a plain `pg_isready -h 127.0.0.1` reports DOWN on a perfectly healthy box.
PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
if [ -n "$PGBIN" ] && "$PGBIN/pg_isready" -h /tmp/pgrun -p 5445 >/dev/null 2>&1; then
  echo "POSTGRES  up on 5445"
else
  echo "POSTGRES  DOWN — see CONTRIBUTING.md; the container setup script starts it"
fi

if curl -s --max-time 3 -o /dev/null http://localhost:3000/api/health 2>/dev/null; then
  echo "APP  up on 3000"
else
  echo "APP  not running — node --env-file=.env server.js"
fi

echo
echo "Here: CLAUDE.md for the invariants, CONTRIBUTING.md for how to run it."
echo "Three suites — npm test, npm run test:db, and tools/browser-tests."
echo "==================================================================="
