#!/usr/bin/env bash
#
# Install and enable the systemd units.
#
#   sudo ./contrib/install-units.sh                     the defaults
#   sudo ./contrib/install-units.sh --dry-run           print, change nothing
#   sudo ./contrib/install-units.sh --dir /opt/reportlog --user rl
#   sudo ./contrib/install-units.sh --log-dir /srv/elsewhere   the log's checkout
#
# WHY THIS EXISTS. The instructions were five commands, and one of them —
# enabling the anchor timer — was once missing from the list in contrib's own
# README. A deployment that followed those instructions exactly never
# anchored, and nothing noticed, because a deployment that is not anchoring
# looks completely healthy. Five commands a person types from a list is five
# chances to stop after four.
#
# It also does the substitution the guide used to ask for by hand. The shipped
# units name /srv/reportlog and a `reportlog` user, and the guide says to
# change User, Group, WorkingDirectory, ExecStart and ReadWritePaths
# *together* — which is exactly the kind of instruction that gets followed
# four times out of five.
#
# IT IS IDEMPOTENT. Run it again after a release that adds a unit and it
# installs the new one and leaves the rest alone.
#
# IT PRINTS WHAT IT WILL DO FIRST, and --dry-run prints without doing it.
# `npm run doctor` installs nothing at all, which is the right posture for a
# diagnostic; this one changes the system, so the compromise is that you can
# read every command before it runs.

set -euo pipefail

DIR=/srv/reportlog
USER_NAME=reportlog
# Where root's copy of the updater lives. OUTSIDE the checkout on purpose:
# the application owns and can write the checkout, and the update unit runs
# this file as root. See contrib/systemd/reportlog-update.service.
LIBEXEC=/usr/local/libexec/reportlog
BACKUP_DIR=
LOG_DIR=
NODE_BIN=
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)        DIR="${2:?--dir needs a path}"; shift 2 ;;
    --user)       USER_NAME="${2:?--user needs a name}"; shift 2 ;;
    --backup-dir) BACKUP_DIR="${2:?--backup-dir needs a path}"; shift 2 ;;
    --log-dir)    LOG_DIR="${2:?--log-dir needs a path}"; shift 2 ;;
    --node)       NODE_BIN="${2:?--node needs a path}"; shift 2 ;;
    --dry-run|-n) DRY=1; shift ;;
    -h|--help)    sed -n '3,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say()  { printf '  %s\n' "$*"; }
run()  { if [ "$DRY" = 1 ]; then printf '    %s\n' "$*"; else eval "$@"; fi; }

SRC="$DIR/contrib/systemd"
[ -d "$SRC" ] || { echo "No unit files at $SRC — is --dir right?" >&2; exit 1; }

# The Node path is the single most common reason a unit fails to start, and
# the failure message names a missing file rather than a missing interpreter.
# A version manager (nvm, fnm, asdf) puts node in a home directory that
# systemd never looks in, because systemd does not read a shell profile.
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node || true)"
fi
[ -n "$NODE_BIN" ] || { echo "No node on PATH. Pass --node /path/to/node." >&2; exit 1; }
case "$NODE_BIN" in
  /home/*|/root/*|*/.nvm/*|*/.fnm/*|*/.asdf/*)
    echo "  !  node is at $NODE_BIN, inside a home directory."
    echo "     systemd does not read your shell profile, and ProtectHome in these"
    echo "     units hides it even if it did. Install a system Node package, or"
    echo "     pass --node with a path outside /home and relax ProtectHome yourself."
    exit 1 ;;
esac

if [ -z "$BACKUP_DIR" ]; then
  BACKUP_DIR="$(grep -sE '^BACKUP_DIR=' "$DIR/.env" | tail -1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
  [ -n "$BACKUP_DIR" ] || BACKUP_DIR=/var/backups/reportlog
fi

# THE TRANSPARENCY LOG'S CHECKOUT. The anchor unit may write exactly one
# directory outside the application, and systemd refuses to start a unit
# whose ReadWritePaths names a directory that does not exist — so a box that
# never made it never anchored, with nothing on the screen to say why. The
# directory is made here, empty and owned by the service user; cloning the
# log into it needs a remote and a key, which are a person's (INSTALL.md
# §3.13). `npm run configure` writes the same path into .env.
if [ -z "$LOG_DIR" ]; then
  LOG_DIR="$(grep -sE '^TRANSPARENCY_LOG_DIR=' "$DIR/.env" | tail -1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
  [ -n "$LOG_DIR" ] || LOG_DIR="$DIR-transparency-log"
fi

echo
echo "Installing the ReportLog units"
echo
say "checkout     $DIR"
say "user         $USER_NAME"
say "node         $NODE_BIN"
say "backups to   $BACKUP_DIR"
say "log checkout $LOG_DIR"
say "updater to   $LIBEXEC/update-apply.sh (root-owned, outside the checkout)"
[ "$DRY" = 1 ] && say "(dry run — nothing below is executed)"
echo

id -u "$USER_NAME" >/dev/null 2>&1 || {
  echo "  !  there is no user called $USER_NAME." >&2
  echo "     sudo adduser --system --group --home $DIR $USER_NAME" >&2
  exit 1
}

# Substituted into a temp copy rather than edited in place: the checkout is a
# git working tree, and a release that changed a unit would then conflict with
# the local edit. The files on disk stay exactly as shipped.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The log's path goes through a placeholder first: it contains the string
# /srv/reportlog, and the next substitution would otherwise rewrite it.
for src in "$SRC"/reportlog*.service "$SRC"/reportlog*.timer; do
  base="$(basename "$src")"
  sed -e "s#/srv/reportlog-transparency-log#@@LOG_DIR@@#g" \
      -e "s#/srv/reportlog#$DIR#g" \
      -e "s#^User=reportlog#User=$USER_NAME#" \
      -e "s#^Group=reportlog#Group=$USER_NAME#" \
      -e "s#/usr/bin/node#$NODE_BIN#g" \
      -e "s#/var/backups/reportlog#$BACKUP_DIR#g" \
      -e "s#@@LOG_DIR@@#$LOG_DIR#g" \
      "$src" > "$TMP/$base"
done

say "units found  $(ls -1 "$TMP" | wc -l | tr -d ' ')"
echo

# --- root's copy of the updater ---------------------------------------------
# Read through the checkout's owner, because git refuses to read a
# repository another user owns and this script runs as root.
as_owner_git() { runuser -u "$USER_NAME" -- git -C "$DIR" "$@"; }

# Installed from the COMMITTED version, not from the file on disk, and only
# when the two agree. An edited updater in the working tree is either a
# person's experiment or something the application wrote; neither belongs
# in a file root runs every minute.
#
# WHAT THIS DOES NOT PROTECT AGAINST, stated so nobody assumes it does: it
# trusts the checkout at the moment it runs. On a box you suspect, do not
# run it — reinstall from a fresh clone instead.
if [ -d "$DIR/.git" ]; then
  as_owner_git diff --quiet HEAD -- contrib/update-apply.sh 2>/dev/null || {
    echo "  !  contrib/update-apply.sh has local changes in $DIR." >&2
    echo "     Root would be installing an edited updater. Look at them:" >&2
    echo "       sudo -u $USER_NAME git -C $DIR diff -- contrib/update-apply.sh" >&2
    exit 1
  }
  as_owner_git show HEAD:contrib/update-apply.sh > "$TMP/update-apply.sh" 2>/dev/null || {
    echo "  !  could not read contrib/update-apply.sh at HEAD in $DIR." >&2
    exit 1
  }
else
  # A tarball install has no history to read from, so the file is all
  # there is.
  cp "$DIR/contrib/update-apply.sh" "$TMP/update-apply.sh"
fi
run "install -d -m 755 -o root -g root '$LIBEXEC'"
run "install -m 755 -o root -g root '$TMP/update-apply.sh' '$LIBEXEC/update-apply.sh'"

# The backup directory has to exist and be writable by the service user, or
# the first run dies having already spent the time dumping.
run "install -d -m 700 -o '$USER_NAME' -g '$USER_NAME' '$BACKUP_DIR'"
# Made only when missing: an existing one is a checkout somebody cloned, and
# its ownership and mode are theirs.
if [ -d "$LOG_DIR" ]; then
  say "log checkout already exists, left as it is"
else
  run "install -d -m 755 -o '$USER_NAME' -g '$USER_NAME' '$LOG_DIR'"
fi
run "install -m 644 '$TMP'/reportlog*.service '$TMP'/reportlog*.timer /etc/systemd/system/"
run "systemctl daemon-reload"

# --- one sudoers line, so deploy.sh can finish ------------------------------
#
# WHY. contrib/deploy.sh runs as the service user and uses sudo for exactly
# one thing: restarting the service. Nothing granted it that, so every deploy
# of every box has ended with a person typing `sudo systemctl restart
# reportlog` by hand. A command a person has to finish by hand every time is a
# command that is not finished.
#
# This was invisible on the path that matters most and bit on the path that is
# actually used: contrib/update-apply.sh runs AS ROOT from a timer, so the
# in-app updater's restart always worked.
#
# NARROW ON PURPOSE. One verb, one unit, no wildcard, no shell. A general sudo
# grant would hand the application a way to run anything as root, which undoes
# the whole point of running it as an unprivileged user. Both systemctl paths
# are listed because sudoers matches the resolved path and the two differ
# between distributions; only the ones that exist are written.
SUDOERS=/etc/sudoers.d/reportlog-restart
sudo_cmds=""
for p in /bin/systemctl /usr/bin/systemctl; do
  [ -x "$p" ] || continue
  # BOTH SPELLINGS of the unit name. sudoers matches the arguments as
  # literal strings, and deploy.sh says `restart reportlog` while the unit
  # file is reportlog.service — granting only one of those leaves the grant
  # in place and the restart still refused, which is the exact failure this
  # is fixing.
  [ -n "$sudo_cmds" ] && sudo_cmds="$sudo_cmds, "
  sudo_cmds="$sudo_cmds$p restart reportlog, $p restart reportlog.service"
done

if [ -z "$sudo_cmds" ]; then
  say "no systemctl binary found, so no sudoers dropin"
elif ! command -v visudo >/dev/null 2>&1; then
  say "visudo not found — writing no sudoers dropin rather than an unchecked one"
  say "deploy.sh will keep asking for the restart by hand"
else
  say "sudoers      $SUDOERS ($USER_NAME may restart reportlog.service)"
  if [ "$DRY" = 1 ]; then
    printf '    %s\n' "$USER_NAME ALL=(root) NOPASSWD: $sudo_cmds"
  else
    # CHECKED BEFORE IT IS INSTALLED. A malformed file in /etc/sudoers.d can
    # break sudo for everyone on the box, including the person who would have
    # to fix it, so it is validated in a temporary location first and only
    # moved into place if visudo accepts it.
    printf '# Installed by contrib/install-units.sh. One command, deliberately.\n%s ALL=(root) NOPASSWD: %s\n' \
      "$USER_NAME" "$sudo_cmds" > "$TMP/reportlog-restart"
    if visudo -cqf "$TMP/reportlog-restart" >/dev/null 2>&1; then
      install -m 440 -o root -g root "$TMP/reportlog-restart" "$SUDOERS"
    else
      echo "  !  visudo rejected the dropin, so nothing was installed:" >&2
      visudo -cf "$TMP/reportlog-restart" 2>&1 | sed 's/^/     /' >&2
      echo "     Everything else is installed. deploy.sh will keep asking" >&2
      echo "     for the restart by hand." >&2
    fi
  fi
fi

# The app is a service; everything else is driven by a timer, and enabling the
# .service of a timer-driven unit is the mistake that makes it look installed
# and never run.
run "systemctl enable --now reportlog.service"
for t in "$TMP"/reportlog-*.timer; do
  run "systemctl enable --now '$(basename "$t")'"
done

echo
if [ "$DRY" = 1 ]; then
  echo "  Nothing was changed. Drop --dry-run to do it."
  echo
  exit 0
fi

echo "What systemd now has"
echo
systemctl list-timers --all 'reportlog-*' --no-pager || true
echo
systemctl is-active reportlog.service >/dev/null 2>&1 \
  && say "reportlog.service is active" \
  || { say "reportlog.service is NOT active — journalctl -u reportlog -n 30"; exit 1; }

echo
say "Check the rest with: npm run doctor"
echo
