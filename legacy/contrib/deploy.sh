#!/bin/bash
# Deploy whatever is on the remote branch, then say whether it worked.
#
#   cd /srv/reportlog && ./contrib/deploy.sh
#
# Run it as the user that owns the checkout. It uses sudo for exactly one
# thing — restarting the service — and tells you the command if it cannot.
#
# WHAT IT WILL NOT DO. It will not deploy over uncommitted changes, it will
# not merge (fast-forward only), and it will not leave you guessing: if the
# service does not come back it says so and shows the last of the journal.
#
# Everything here is ordered so a failure stops before it touches the
# service. Dependencies and migrations happen first; the restart is last.
set -uo pipefail

# The whole script is one function, called on the last line. bash reads a
# script as it runs it, and this script's own pull can replace the file
# under it: an old copy then carries on with offsets from the new one and skips
# or repeats steps (a release added a step and the first deploy of it never ran
# it). A function is parsed completely before it is called, so the running copy
# is the one that started.
main() {
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${REPORTLOG_SERVICE:-reportlog}"
cd "$REPO" || exit 1

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n%s\n\n' "FAILED: $*" >&2; exit 1; }

say "ReportLog deploy — $REPO"

# --- refuse to deploy over somebody's work ----------------------------
[ -d .git ] || fail "$REPO is not a git checkout."
DIRTY=$(git status --porcelain | grep -v '^?? ' | wc -l)
if [ "$DIRTY" -gt 0 ]; then
  git status --short | grep -v '^?? '
  fail "there are uncommitted changes. Deploying would discard or fight them."
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
BEFORE=$(git rev-parse --short HEAD)

# --- what is about to land --------------------------------------------
say "Fetching"
# WHY A FETCH FAILED IS NOT THE SAME QUESTION AS WHETHER IT FAILED, and
# "could not reach the remote" — which is what stood here — is a guess. It
# was wrong for the case that actually happens: this repository is private,
# so a deployment whose service user has no credential gets an
# AUTHENTICATION failure and was told to go and look at its firewall.
#
# The application learned this already (`classifyFetchFailure` in
# src/updateCheck.js, and the sentences beside it). deploy.sh had the same
# wrong guess in shell and nothing connected the two, so the fix landed in
# one place and the other went on saying it. The same causes, the same
# fixes, said the same way.
#
# NOTHING OF GIT'S OUTPUT IS REPEATED BACK except to the person at the
# terminal who just ran this, which is where it already was. The sentences
# are fixed strings for the reason the application's are: git's error text
# can carry the remote URL and a URL can carry an embedded token.
FETCH_ERR="$(git fetch --quiet origin "$BRANCH" 2>&1)" || {
  printf '%s\n' "$FETCH_ERR" | sed 's/^/  /' >&2
  LOWER="$(printf '%s' "$FETCH_ERR" | tr '[:upper:]' '[:lower:]')"
  case "$LOWER" in
    *"could not read username"*|*"could not read password"*|*"terminal prompts disabled"*\
    |*"authentication failed"*|*"permission denied"*|*"invalid username or password"*\
    |*"repository not found"*|*"403"*)
      fail "this checkout cannot authenticate to the remote. The repository is
private, so the \`$(id -un)\` user needs a credential of its own — not
yours and not root's. Over HTTPS with a personal access token:

    sudo -u $(id -un) git -C $REPO remote set-url origin \\
      https://github.com/munsdev/reportlog.git
    sudo -u $(id -un) git -C $REPO config --global credential.helper store
    sudo -u $(id -un) git -C $REPO fetch origin

The username at the prompt is your GitHub login, not your email, and the
password is the token. Do not paste the token into the URL: it clones and
then breaks the Updates button. See the private-clone note in the install
guide." ;;
    *"could not resolve host"*|*"name or service not known"*\
    |*"temporary failure in name resolution"*)
      fail "the remote's hostname could not be resolved. That is DNS on this box
rather than anything about the repository or its credentials." ;;
    *"connection refused"*|*"connection timed out"*|*"network is unreachable"*)
      fail "the remote could not be reached. This one really is the network." ;;
    *)
      fail "the fetch failed for a reason this cannot name. Git's own words are
above; they are the thing to go on." ;;
  esac
}

BEHIND=$(git rev-list --count "HEAD..origin/$BRANCH")
if [ "$BEHIND" -eq 0 ]; then
  echo "  Already up to date at $BEFORE on $BRANCH."
  echo "  Nothing to deploy. Re-running the steps below anyway would be a"
  echo "  restart, not a deploy — use: sudo systemctl restart $SERVICE"
  exit 0
fi

echo "  $BEHIND commit(s) to apply, $BEFORE..$(git rev-parse --short origin/$BRANCH):"
git --no-pager log --oneline "HEAD..origin/$BRANCH" | sed 's/^/    /'

# Migrations are the part worth seeing before they run: they are additive by
# rule, but "additive" is a rule about the code, not a promise about tonight.
PENDING_MIG=$(git diff --name-only "HEAD..origin/$BRANCH" -- migrations/ | wc -l)
if [ "$PENDING_MIG" -gt 0 ]; then
  echo
  echo "  This carries $PENDING_MIG migration file change(s):"
  git diff --name-only "HEAD..origin/$BRANCH" -- migrations/ | sed 's/^/    /'
fi

say "Pulling"
git pull --ff-only --quiet origin "$BRANCH" \
  || fail "not a fast-forward. Somebody has committed on the box, or history was rewritten."
AFTER=$(git rev-parse --short HEAD)
echo "  $BEFORE -> $AFTER"

# Root never runs the checkout's copy of the updater — it runs one
# install-units.sh put outside the checkout. Since 11 October that copy
# RENEWS ITSELF from the commit it verified, so a release changing it no
# longer needs a person. This notice says so rather than saying nothing,
# because somebody who read the old guide is expecting to be sent to a
# shell. Said HERE, right after the pull, because a run as the service user
# stops at the restart when it cannot sudo, and a notice saved for the end
# would never be seen on exactly the box that needs it.
UPDATER_CHANGED=""
git diff --quiet "$BEFORE" HEAD -- contrib/update-apply.sh || UPDATER_CHANGED=yes
updater_notice() {
  [ -n "$UPDATER_CHANGED" ] || return 0
  echo
  echo "  This release changes the updater. Root runs a separate copy of it,"
  echo "  outside the checkout; the units step below reinstalls that copy, and"
  echo "  the copy on the box renews itself from the commit it verified in any"
  echo "  case. Nothing for you to do. If you want it in step now:"
  echo "      sudo $REPO/contrib/install-units.sh"
  echo
}
updater_notice

# AND THE SAME FOR THE UNITS THEMSELVES, which is the gap that actually bit.
#
# This script pulls, migrates and restarts. It does NOT install units —
# install-units.sh does, and it is run once at install time. So a release
# that ADDS a timer gives a running box the new code and not the new timer,
# and nothing anywhere says so.
#
# That is exactly what happened to the Updates feature: its own timer,
# reportlog-update.timer, arrived in the release that added the pane. Boxes
# deployed with this script got a button with no worker behind it, wrote a
# request into var/ that nothing ever read, and were told it would start
# within a minute. The pane reports it now too, because a notice printed
# during a deploy somebody else ran is a notice nobody reads — but it should
# have been said here first.
#
# ADDED OR CHANGED, both: a unit whose ExecStart or schedule moved needs the
# reinstall as much as a new one does.
UNITS_CHANGED=$(git diff --name-only "$BEFORE" HEAD -- contrib/systemd/ | wc -l | tr -d ' ')
UNITS_INSTALLED=""
units_notice() {
  [ "${UNITS_CHANGED:-0}" -gt 0 ] || return 0
  [ -z "$UNITS_INSTALLED" ] || return 0
  echo
  echo "  THIS RELEASE CHANGES WHAT SYSTEMD SHOULD BE RUNNING ($UNITS_CHANGED unit file(s)),"
  echo "  and they could NOT be installed here. Until you run this, the new or"
  echo "  changed ones are not on the box:"
  echo "      sudo $REPO/contrib/install-units.sh"
  git diff --name-only "$BEFORE" HEAD -- contrib/systemd/ | sed 's|^|        |'
  echo
}

# --- dependencies, exactly as the lockfile says -----------------------
say "Installing dependencies"
# npm ci and not npm install: it installs exactly the lockfile and FAILS if
# package.json and the lockfile disagree, which is the check that has caught
# a bad release twice.
npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 \
  || fail "npm ci failed. package.json and package-lock.json probably disagree — run it again without the redirect to see."
echo "  ok"

say "Migrating"
npm run migrate 2>&1 | sed 's/^/  /' || fail "migrations failed. The service has NOT been restarted."

# The Updates pane shows the last thing an update recorded. A deploy by hand
# is an update too, so it records itself — otherwise a failure from an
# earlier button press goes on being shown as the latest word on a box that
# has since been updated past it. Written the way update-apply.sh writes it:
# a temporary file renamed into place, so the pane never reads half of one.
if [ -d var ]; then
  STATUS_TMP="$(mktemp var/.status.XXXXXX 2>/dev/null)" && {
    printf '{"state":"done","detail":"%s","at":"%s","commit":"%s"}\n' \
      "deployed by hand over SSH, $BEFORE to $AFTER" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git rev-parse HEAD)" > "$STATUS_TMP" \
      && chmod 644 "$STATUS_TMP" && mv -f "$STATUS_TMP" var/update-status.json
  } || true
fi

# --- units, BEFORE the restart ----------------------------------------
#
# THIS SCRIPT INSTALLS UNITS NOW, AND THAT IS THE WHOLE FIX. It used to only
# warn, and a warning is a thing somebody scrolls past: a release that ADDED
# a timer deployed the code and left the timer uninstalled. That is exactly
# how `reportlog-update.timer` went missing on boxes upgraded over SSH, which
# meant the admin page's Updates button had nothing behind it — it wrote a
# request into var/ that nothing read, under the words "it starts within a
# minute".
#
# NOT A NEW PRIVILEGE. This script already sudo's to restart the service a
# few lines down, so it is already a script a person runs with sudo
# available; install-units.sh is root-owned and does the same job it does at
# install time. Running it from here is the same trust, applied one step
# earlier.
#
# IDEMPOTENT, so it is run whenever the units changed and nothing is
# conditional on guessing which ones: it enables every unit the deployment
# should have and changes nothing already right.
#
# BEFORE THE RESTART, so the service comes up with the timers its own
# release expects rather than a minute later.
if [ "${UNITS_CHANGED:-0}" -gt 0 ]; then
  say "Installing systemd units ($UNITS_CHANGED changed)"
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "  No systemctl here, so there are no units to install."
    UNITS_INSTALLED=skipped
  elif sudo -n true 2>/dev/null || sudo -v 2>/dev/null; then
    if sudo "$REPO/contrib/install-units.sh" 2>&1 | sed 's/^/  /'; then
      UNITS_INSTALLED=yes
    else
      # NOT FATAL. The code is already on disk and the service still has to
      # come back; a box left un-restarted because a unit failed to install
      # is worse than one running new code with an old timer. The notice at
      # the end says what is still owed.
      echo "  install-units.sh did not finish. The deploy continues; see the notice below."
    fi
  else
    echo "  Cannot sudo, so the units were not installed."
  fi
fi

# --- the only other privileged step -----------------------------------
#
# THE PROBE IS THE RESTART ITSELF, not `sudo true`. install-units.sh grants
# this user one command and one only — `systemctl restart <service>` — so
# `sudo -n true` is REFUSED on a correctly configured box and the old probe
# read that refusal as "cannot sudo at all". Every deploy then ended with the
# notice below and a person typing the restart by hand, which is the thing
# the grant exists to stop. `sudo -l <command>` asks about exactly the
# command we are about to run and nothing else.
can_restart() {
  sudo -n -l systemctl restart "$SERVICE" >/dev/null 2>&1 && return 0
  sudo -n true 2>/dev/null && return 0
  sudo -v 2>/dev/null
}
say "Restarting $SERVICE"
if ! command -v systemctl >/dev/null 2>&1; then
  echo "  No systemctl here. Restart it however this box runs it."
elif can_restart; then
  sudo systemctl restart "$SERVICE" || fail "systemctl restart $SERVICE failed."
  echo "  restarted"
else
  echo "  Cannot sudo. Run this yourself:"
  echo "      sudo systemctl restart $SERVICE"
  echo
  echo "  To stop having to: sudo $REPO/contrib/install-units.sh"
  echo "  installs a sudoers dropin granting this one command and no other."
  exit 1
fi

# --- nginx, but only to reload it -------------------------------------
# The Content-Security-Policy lives in contrib/nginx/csp.conf, which the live
# server block includes, so a release that changes it has landed on disk by
# now and nginx only needs telling. This never edits a config file. It reloads
# only if nginx's own test passes, so a bad config cannot take the site down.
say "Reloading nginx"
if ! command -v nginx >/dev/null 2>&1; then
  echo "  No nginx here. Nothing to reload."
elif ! sudo -n true 2>/dev/null; then
  echo "  Cannot sudo. If this release changed contrib/nginx/, run:"
  echo "      sudo nginx -t && sudo systemctl reload nginx"
else
  if ! sudo nginx -T 2>/dev/null | grep -q 'contrib/nginx/csp.conf'; then
    echo "  WARNING: the live nginx config does not include contrib/nginx/csp.conf,"
    echo "  so it serves whatever policy was pasted in by hand (or none). One-time"
    echo "  fix: replace the two add_header Content-Security-Policy lines with"
    echo "      include $REPO/contrib/nginx/csp.conf;"
    echo "  (see contrib/README.md). After that this step keeps it current."
  fi
  if ! sudo nginx -T 2>/dev/null | grep -q 'contrib/nginx/cache.conf'; then
    echo "  WARNING: the live nginx config does not include contrib/nginx/cache.conf,"
    echo "  so browsers guess how long to keep scripts — which once left a white"
    echo "  page after an update. One-time fix: in the server block, under the"
    echo "  csp.conf include, add"
    echo "      include $REPO/contrib/nginx/cache.conf;"
    echo "  then: sudo nginx -t && sudo systemctl reload nginx"
  fi
  if sudo nginx -t >/dev/null 2>&1; then
    sudo systemctl reload nginx && echo "  reloaded"
  else
    echo "  nginx -t FAILED, so it was not reloaded. Running config is untouched."
    sudo nginx -t 2>&1 | sed 's/^/    /'
  fi
fi

# --- did it actually come back? ---------------------------------------
say "Checking it came back"
PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
PORT="${PORT:-5000}"
UP=""
for _ in $(seq 1 20); do
  sleep 1
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then UP=yes; break; fi
done

if [ -z "$UP" ]; then
  echo "  NOT answering on 127.0.0.1:$PORT after 20s."
  command -v journalctl >/dev/null 2>&1 && sudo journalctl -u "$SERVICE" -n 25 --no-pager
  fail "deployed $AFTER but the service is not up. It is running the new code and failing — roll back with: git reset --hard $BEFORE && npm ci --omit=dev && sudo systemctl restart $SERVICE"
fi
echo "  answering on 127.0.0.1:$PORT"

# --- and is it sane? --------------------------------------------------
# /api/health says the process is alive. The doctor says whether the
# deployment can actually be used, which is a different question and the one
# somebody asks next.
say "State of the deployment"
npm run --silent doctor 2>&1 | sed 's/^/  /' || true

say "Deployed $AFTER on $BRANCH"
# Both notices again at the end, for the same reason the first copy exists:
# whichever one applies is the thing somebody has to go and do, and the
# doctor's output above is long enough to push the earlier copy off a
# terminal.
updater_notice
units_notice
}

main "$@"
exit $?
