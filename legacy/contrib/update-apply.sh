#!/usr/bin/env bash
#
# Apply an update the admin pane asked for. RUNS AS ROOT, from a timer.
#
#   /srv/reportlog/contrib/update-apply.sh            do it
#   /srv/reportlog/contrib/update-apply.sh --dry-run  say what it would do
#
# It is driven by reportlog-update.timer and is not reachable from a web
# request. The application's only part in this is leaving a file saying
# which commit somebody approved.
#
# ---------------------------------------------------------------------------
# WHY THIS IS NOT JUST `sudo deploy.sh` FROM THE APP
#
# An in-app update button is a path from "somebody sent an HTTP request" to
# "code runs on the server". On an archive holding people's identities that
# is the most valuable thing an attacker could find, so the application is
# given no privilege it did not already have. It writes a request; this
# re-decides everything, as root, and applies it.
#
# THE SPECIFIC TRAP. reportlog.service sets ReadWritePaths=/srv/reportlog,
# so the application can write its own checkout — INCLUDING .git/config. A
# worker that pulled from the repository's own `origin` would be trusting a
# file the attacker controls, and the whole split would buy nothing. So:
#
#   * the fetch URL comes from EXPECTED_REMOTE in the unit, never from the
#     repository
#   * the request may only name the exact commit that URL is serving as the
#     tip of the branch, so "install this arbitrary commit" is not sayable
#   * the merge is fast-forward only, so history cannot be rewritten under us
#   * NOTHING FROM THE CHECKOUT IS EXECUTED AS ROOT. Every repo command runs
#     as the service user through runuser. Root only fetches, restarts and
#     writes status.
#
# The worst an attacker holding the whole application can do through this is
# make the deployment install genuine upstream code earlier than its operator
# meant to. They cannot choose what runs.
# ---------------------------------------------------------------------------

set -uo pipefail

REPO="${REPORTLOG_DIR:-/srv/reportlog}"
SERVICE="${REPORTLOG_SERVICE:-reportlog}"
APP_USER="${REPORTLOG_USER:-reportlog}"
BRANCH="${REPORTLOG_BRANCH:-stable}"
EXPECTED_REMOTE="${REPORTLOG_REMOTE:-https://github.com/munsdev/reportlog.git}"
MAX_AGE_SECONDS="${REPORTLOG_REQUEST_MAX_AGE:-1800}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

REQUEST="$REPO/var/update-request.json"
STATUS="$REPO/var/update-status.json"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Status is what the pane shows. Written by root into a directory the app can
# write, which is fine: it is display only and nothing trusts it back.
write_status() {
  local state="$1" detail="$2" commit="${3:-}"
  [ "$DRY" = 1 ] && { log "would set status: $state — $detail"; return 0; }
  local tmp
  tmp="$(mktemp "$REPO/var/.status.XXXXXX")" || return 0
  printf '{"state":"%s","detail":%s,"at":"%s","commit":"%s"}\n' \
    "$state" "$(printf '%s' "$detail" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$commit" > "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$STATUS"
}

give_up() {
  log "REFUSED: $*"
  write_status failed "$*"
  # A dry run changes nothing, including this. The first version deleted the
  # request even under --dry-run, so inspecting why a request was refused
  # destroyed the thing being inspected.
  [ "$DRY" = 1 ] || rm -f "$REQUEST"
  exit 1
}

# Clone URLs for the same repository differ cosmetically — with or without a
# `.git` suffix, with or without a trailing slash, over HTTPS or over SSH —
# and git itself treats them as one. Comparing the raw strings refused every
# legitimate deployment whose clone line happened not to match the default,
# which is most of them.
#
# THE TRANSPORT IS PART OF THAT, and leaving it out cost a test box its
# update button. It was cloned over SSH, so its origin read
# `git@github.com:munsdev/reportlog.git` while the unit holds the plain
# HTTPS URL. Same host, same path, same repository, same commits — and the
# updater refused with "origin is git@github.com:…, expected https://…",
# which reads like a tampered .git/config and was a clone line.
#
# IT COSTS NOTHING THAT MATTERS. The fetch URL comes from the unit either
# way; this comparison is a tripwire for something having rewritten
# .git/config, and the host and the path still have to be identical to pass
# it. A rewrite to another host or another repository is caught exactly as
# before. Only `ssh://`, `git@`, `https://` and their punctuation are
# ignored, and they are what the SAME repository looks like written four
# ways.
normalize_remote() {
  printf '%s' "$1" \
    | sed -e 's#/*$##' -e 's#\.git$##' \
          -e 's#^[a-z][a-z0-9+.-]*://##' \
          -e 's#^[^/@]*@##' \
          -e 's#:#/#'
}

# EVERY GIT CALL ON THE CHECKOUT, READS INCLUDED, RUNS AS ITS OWNER.
#
# The writes always did. The four reads did not, and on the first real box
# the first one failed: since git 2.35.2 git refuses to read a repository
# owned by a different user ("detected dubious ownership"), root is a
# different user from reportlog, and `2>/dev/null` swallowed the refusal. So
# `remote get-url origin` came back EMPTY and the update was refused as
# "origin is , expected https://github.com/munsdev/reportlog.git" — which
# reads like a tampered .git/config and was only git declining to look.
#
# Nothing in the container noticed, because there root owned the checkout
# and git had nothing to object to.
#
# NOT `git config --global --add safe.directory`. That would teach root's
# git to trust a directory the application can write, which is the
# opposite of what this script is for. Asking the owner is the fix that
# keeps the rule the script already states: nothing out of the checkout
# runs as root.
repo_git() {
  runuser -u "$APP_USER" -- git -C "$REPO" "$@"
}

# --- is there anything to do ------------------------------------------------
[ -e "$REQUEST" ] || exit 0

# --- this file must be one the application cannot write ---------------------
# Root runs this. If it lives anywhere the application can write, then the
# application decides what root runs, and every other check below is
# theatre: a compromised app would simply replace this file. That was the
# shipped arrangement until 10 October — the unit ran it straight out of the
# checkout, every minute, and the application owns the checkout.
#
# install-units.sh installs a root-owned copy outside the checkout and the
# unit runs that. These checks are not a defence against an attacker who
# controls this file — nothing written in it could be — they are what an
# HONEST box still on the old unit hears, the first time somebody presses
# the button after pulling this release.
SELF="$(readlink -f "${BASH_SOURCE[0]:-$0}")"
case "$SELF" in
  "$(readlink -f "$REPO")"/*)
    give_up "this updater is running from inside $REPO, which the application can write, so the application decides what root runs. Install the root-owned copy: sudo $REPO/contrib/install-units.sh" ;;
esac
[ "$(stat -c %u "$SELF")" = 0 ] \
  || give_up "this updater ($SELF) is not owned by root. Reinstall it: sudo $REPO/contrib/install-units.sh"
[ -z "$(find "$SELF" -perm /022 2>/dev/null)" ] \
  || give_up "this updater ($SELF) is writable by somebody other than root. Reinstall it: sudo $REPO/contrib/install-units.sh"

# A symlink here would be the application asking root to read a file of its
# choosing. It is only ever a regular file it wrote itself.
[ -L "$REQUEST" ] && give_up "the request is a symlink"
[ -f "$REQUEST" ] || give_up "the request is not a regular file"

OWNER="$(stat -c %U "$REQUEST" 2>/dev/null)"
[ "$OWNER" = "$APP_USER" ] || [ "$OWNER" = root ] \
  || give_up "the request is owned by $OWNER, not $APP_USER"

[ -d "$REPO/.git" ] || give_up "$REPO is not a git checkout"

# --- read it, strictly ------------------------------------------------------
# Parsed in shell on purpose. Node would be easier and would mean running an
# interpreter over a file in a directory the application can write, as root,
# which is the thing this script exists to avoid. These two greps accept a
# 40-character hex id and an ISO timestamp and nothing else.
BODY="$(tr -d '\n' < "$REQUEST")"
TARGET="$(printf '%s' "$BODY" \
  | grep -oE '"targetCommit"[[:space:]]*:[[:space:]]*"[0-9a-f]{40}"' \
  | grep -oE '[0-9a-f]{40}' | head -1)"
REQUESTED_AT="$(printf '%s' "$BODY" \
  | grep -oE '"requestedAt"[[:space:]]*:[[:space:]]*"[0-9TZ:.+-]{20,32}"' \
  | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z?' | head -1)"

[ -n "$TARGET" ] || give_up "no usable target commit in the request"
[ -n "$REQUESTED_AT" ] || give_up "no usable timestamp in the request"

THEN="$(date -u -d "$REQUESTED_AT" +%s 2>/dev/null)" \
  || give_up "the timestamp is not a date"
NOW="$(date -u +%s)"
AGE=$(( NOW - THEN ))
# Applying an old request installs something nobody has looked at since.
[ "$AGE" -le "$MAX_AGE_SECONDS" ] || give_up "the request is ${AGE}s old; the limit is ${MAX_AGE_SECONDS}s"
[ "$AGE" -ge -60 ] || give_up "the request is dated in the future"

log "request: $TARGET (${AGE}s old)"
write_status running "checking the remote" "$TARGET"

# --- the remote, from the unit and never from the repository ----------------
CONFIGURED="$(repo_git remote get-url origin 2>/dev/null)"
if [ "$(normalize_remote "$CONFIGURED")" != "$(normalize_remote "$EXPECTED_REMOTE")" ]; then
  # Not fatal by itself — the fetch below does not use it — but it means
  # something rewrote .git/config, and that is worth refusing over.
  give_up "origin is $CONFIGURED, expected $EXPECTED_REMOTE"
fi

if [ "$DRY" = 1 ]; then
  log "would fetch $EXPECTED_REMOTE $BRANCH and apply $TARGET"
  exit 0
fi

# Fetched by URL, so .git/config is not consulted for where the code is from.
repo_git fetch --quiet "$EXPECTED_REMOTE" "$BRANCH" \
  || give_up "could not fetch $BRANCH from $EXPECTED_REMOTE"

TIP="$(repo_git rev-parse FETCH_HEAD 2>/dev/null)"
[ -n "$TIP" ] || give_up "the fetch produced no commit"

# THE CHECK THAT MATTERS. The request may only name what the real remote is
# serving right now, so "install this commit of my choosing" cannot be said.
[ "$TARGET" = "$TIP" ] \
  || give_up "the request names $TARGET but $BRANCH is at $TIP — ask again"

BEFORE="$(repo_git rev-parse HEAD)"
[ "$BEFORE" != "$TARGET" ] || { log "already at $TARGET"; write_status done "already up to date" "$TARGET"; rm -f "$REQUEST"; exit 0; }

# --- does this release change the updater itself? --------------------------
#
# IT USED TO GIVE UP HERE, and that was the last case where the admin
# panel's button could not do the job. A release that changed this file sent
# the operator to a shell — which is exactly the half-working that makes
# somebody stop trusting the button at all. It must always work.
#
# So root RENEWS ITS OWN COPY and re-runs it. The property in the header is
# kept exactly:
#
#   * the content comes from "$TIP" — the one commit root itself fetched
#     from the URL in the unit and verified as the branch's tip. It is read
#     as a BLOB out of git, by the checkout's owner, and never executed from
#     the checkout.
#   * it is installed root-owned and root-writable-only, outside the
#     checkout, at the same path install-units.sh uses.
#   * the file then exec'd is that root-owned file. Root still runs nothing
#     the application can write.
#
# So the worst an attacker holding the whole application can still do is
# make the box install genuine upstream code earlier than its operator
# meant to. That has not changed.
#
# ONCE, NEVER TWICE. The renewed copy runs this same check, and if it still
# disagreed it would install and re-exec forever. The marker makes the
# second pass give up instead, with a reason that names the real fault.
if ! repo_git show "$TIP:contrib/update-apply.sh" 2>/dev/null | cmp -s - "$SELF"; then
  if [ -n "${REPORTLOG_UPDATER_RENEWED:-}" ]; then
    give_up "renewed the updater from $TIP and it still does not match the one running. Something is rewriting $SELF. Update by hand: sudo -u $APP_USER bash -c 'cd $REPO && ./contrib/deploy.sh' then: sudo $REPO/contrib/install-units.sh"
  fi

  # NO --dry-run BRANCH HERE, deliberately. A dry run exits above, before the
  # fetch, because fetching writes objects and FETCH_HEAD into the checkout
  # and "say what you would do" should not. That means a dry run has no $TIP
  # and so cannot know whether the release changes this file — it says what
  # it would apply and stops there. A branch written here would never run.
  write_status running "renewing the updater" "$TARGET"

  # WRITTEN BESIDE $SELF AND RENAMED OVER IT, never written into it.
  #
  # THIS SCRIPT IS NOT WRAPPED IN A FUNCTION, so bash is reading it from
  # disk as it runs — the trap deploy.sh's header describes. `install`
  # copies onto the destination IN PLACE, which would rewrite the bytes
  # under the running interpreter and leave it parsing the new file at an
  # old offset. A rename gives a NEW inode, and the running copy keeps its
  # open handle on the old one, so it reads to the end of what it started.
  #
  # The temporary file is in the same directory for that rename to be
  # atomic, and is root-owned and 0755 BEFORE it moves, so there is no
  # instant where $SELF exists writable by anybody else.
  NEW_UPDATER="$(mktemp "$(dirname "$SELF")/.update-apply.XXXXXX")" \
    || give_up "could not make a temporary file beside $SELF"
  repo_git show "$TIP:contrib/update-apply.sh" > "$NEW_UPDATER" 2>/dev/null \
    || { rm -f "$NEW_UPDATER"; give_up "could not read contrib/update-apply.sh out of $TIP"; }
  # A truncated or empty read must never become the thing root runs next.
  [ -s "$NEW_UPDATER" ] && head -n 1 "$NEW_UPDATER" | grep -q '^#!' \
    || { rm -f "$NEW_UPDATER"; give_up "the updater read out of $TIP is not a script"; }
  chown root:root "$NEW_UPDATER" && chmod 755 "$NEW_UPDATER" \
    || { rm -f "$NEW_UPDATER"; give_up "could not set ownership on the renewed updater"; }
  mv -f "$NEW_UPDATER" "$SELF" \
    || { rm -f "$NEW_UPDATER"; give_up "could not move the renewed updater into $SELF"; }
  log "renewed $SELF from $TIP; re-running it"
  REPORTLOG_UPDATER_RENEWED=1 exec "$SELF" "$@"
fi

repo_git merge-base --is-ancestor HEAD FETCH_HEAD \
  || give_up "not a fast-forward; somebody has committed on the box or history was rewritten"

DIRTY="$(repo_git status --porcelain | grep -cv '^?? ')"
[ "$DIRTY" -eq 0 ] || give_up "there are uncommitted changes in $REPO"

# --- a backup BEFORE anything changes ---------------------------------------
# An update carries migrations, migrations touch an append-only archive, and
# the operator clicking a button is not expecting to think about this.
write_status running "taking a backup" "$TARGET"
if ! runuser -u "$APP_USER" -- bash -lc "cd '$REPO' && npm run --silent backup" >/dev/null 2>&1; then
  give_up "the pre-update backup failed; nothing has been changed"
fi
log "backup taken"

# --- apply, all of it as the service user -----------------------------------
write_status running "updating the code" "$TARGET"
repo_git merge --ff-only --quiet FETCH_HEAD \
  || give_up "the fast-forward merge failed"

write_status running "installing dependencies" "$TARGET"
runuser -u "$APP_USER" -- bash -lc "cd '$REPO' && npm ci --omit=dev --no-audit --no-fund" >/dev/null 2>&1 \
  || give_up "npm ci failed — package.json and the lockfile probably disagree"

write_status running "running migrations" "$TARGET"
runuser -u "$APP_USER" -- bash -lc "cd '$REPO' && npm run --silent migrate" >/dev/null 2>&1 \
  || give_up "migrations failed. The service has NOT been restarted."

# --- the only privileged step -----------------------------------------------
write_status running "restarting" "$TARGET"
systemctl restart "$SERVICE" || give_up "systemctl restart $SERVICE failed"

# --- did it come back -------------------------------------------------------
PORT="$(grep -E '^PORT=' "$REPO/.env" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')"
PORT="${PORT:-5000}"
UP=""
for _ in $(seq 1 20); do
  sleep 1
  curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && { UP=yes; break; }
done

rm -f "$REQUEST"

if [ -z "$UP" ]; then
  # Deliberately not rolled back automatically: a half-applied migration plus
  # an automatic revert is how an archive gets damaged. The dump taken above
  # is the way back, and a person decides.
  log "FAILED: $SERVICE is not answering after the update"
  write_status failed "updated to $TARGET but the service did not come back. Roll back: sudo -u $APP_USER git -C $REPO reset --hard $BEFORE && sudo -u $APP_USER bash -lc \"cd $REPO && npm ci --omit=dev\" && systemctl restart $SERVICE" "$TARGET"
  exit 1
fi

# --- nginx, to reload it and nothing else ------------------------------------
# The live config includes files from the checkout — contrib/nginx/csp.conf
# and cache.conf — so a release that changes them has changed what nginx
# WOULD send, and until this step nothing told nginx. deploy.sh always did;
# the button did not, so a header change applied by the button silently never
# reached a browser. This never edits a config file. It reloads only when
# nginx's own test passes, and a failure here is reported, never fatal: the
# app is updated and answering, and the running nginx is untouched.
NGINX_NOTE=""
if command -v nginx >/dev/null 2>&1; then
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx >/dev/null 2>&1 || NGINX_NOTE=" (nginx did not reload — run: sudo systemctl reload nginx)"
  else
    NGINX_NOTE=" (nginx -t failed, so nginx was not reloaded and is running its old config — run: sudo nginx -t)"
  fi
fi

log "updated $BEFORE -> $TARGET$NGINX_NOTE"
write_status done "updated to $TARGET$NGINX_NOTE" "$TARGET"
