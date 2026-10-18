#!/usr/bin/env bash
#
# Everything mechanical in a ReportLog install, in one command.
#
#   sudo ./install.sh --dry-run        print every command, change nothing
#   sudo ./install.sh                  do it
#   sudo ./install.sh --with-attachments
#
# WHAT IT DOES: the packages, the user, the directory, the dependencies, and
# the PostgreSQL role and database. Then it stops and prints the three
# commands only a person can run.
#
# WHY IT STOPS. `npm run configure` is a conversation — it asks for the site's
# address, the database, the mail credentials — and it generates two
# encryption keys that are never displayed and exist only in the file it
# writes. Automating that would mean either inventing answers or printing the
# keys, and the keys not being printed is a property worth keeping. So this
# script does the part that is the same on every box, and hands over.
#
# READ IT BEFORE YOU RUN IT, and `--dry-run` prints every command it would
# execute without executing any. That is the compromise this script makes:
# `npm run doctor` installs nothing at all, which is the right posture for a
# diagnostic, but an installer has to install — so the least it can do is be
# legible first. There is no `curl | bash` form of this on purpose.
#
# TESTED ON Debian and Ubuntu. On anything else it does the parts that do not
# depend on a package manager and tells you to let `npm run doctor` name the
# packages for your system — rather than guessing, which is how an installer
# breaks somebody's server while looking confident.

set -euo pipefail

DIR=/srv/reportlog
USER_NAME=reportlog
DB_NAME=reportlog
DB_USER=reportlog
DB_PASSWORD=
NODE_MAJOR=22
WITH_ATTACHMENTS=0
DRY=0
REPO=https://github.com/munsdev/reportlog.git
# THE SAME REF INSTALL.md TELLS A READER TO CLONE. These two drifting apart is
# worse than either being wrong on its own: the guide once said v0.0.3 while
# this cloned whatever main happened to be, so the scripted path and the
# by-hand path installed different software and the guide described only one
# of them. scripts/selftest.js asserts they still agree.
#
# A BRANCH RATHER THAN A TAG, and not only because a tag cannot be moved
# without deleting it first. `git clone --branch <tag>` leaves a DETACHED
# HEAD, so contrib/deploy.sh — which reads `git rev-parse --abbrev-ref HEAD`
# — gets the literal string `HEAD` and pulls the remote's default branch.
# A box installed from a tag would therefore upgrade itself onto main,
# quietly, the first time anybody ran the upgrade. Cloning a branch gives a
# checkout that tracks it, so deploy.sh fast-forwards along the same branch.
REF=stable

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)               DIR="${2:?}"; shift 2 ;;
    --user)              USER_NAME="${2:?}"; shift 2 ;;
    --db-name)           DB_NAME="${2:?}"; shift 2 ;;
    --db-user)           DB_USER="${2:?}"; shift 2 ;;
    --db-password)       DB_PASSWORD="${2:?}"; shift 2 ;;
    --with-attachments)  WITH_ATTACHMENTS=1; shift ;;
    --dry-run|-n)        DRY=1; shift ;;
    -h|--help)           sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say()  { printf '  %s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
run()  { if [ "$DRY" = 1 ]; then printf '    %s\n' "$*"; else eval "$@"; fi; }

[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || {
  echo "This needs root for the packages and the service user. Try: sudo $0 $*" >&2
  exit 1
}

FAMILY=unknown
if [ -r /etc/os-release ]; then
  . /etc/os-release
  case " ${ID:-} ${ID_LIKE:-} " in
    *debian*|*ubuntu*) FAMILY=apt ;;
    *fedora*|*rhel*)   FAMILY=dnf ;;
    *arch*)            FAMILY=pacman ;;
  esac
fi

echo
echo "ReportLog — install"
echo
say "checkout        $DIR"
say "release         $REF"
say "service user    $USER_NAME"
say "database        $DB_NAME, owned by $DB_USER"
say "attachments     $([ "$WITH_ATTACHMENTS" = 1 ] && echo 'yes — media tools included' || echo 'no — add --with-attachments')"
say "system          $FAMILY"
[ "$DRY" = 1 ] && say "DRY RUN — nothing below is executed"
echo

if [ "$FAMILY" != apt ]; then
  say "!  Only Debian and Ubuntu are handled here. The packages are yours to"
  say "   install; run 'npm run doctor' afterwards and it prints the exact"
  say "   command for this system. Everything else below still applies."
fi

# ---------------------------------------------------------------- packages
step "Packages"
if [ "$FAMILY" = apt ]; then
  # certbot is here because the closing instructions tell you to run it, and
  # for a long time nothing before §3.14 of the guide installed it.
  PKGS="postgresql nginx git curl ca-certificates certbot python3-certbot-nginx"
  [ "$WITH_ATTACHMENTS" = 1 ] && PKGS="$PKGS ffmpeg libheif-examples poppler-utils clamav-daemon"
  run "apt-get update"
  run "DEBIAN_FRONTEND=noninteractive apt-get install -y $PKGS"

  # Node is checked rather than installed blindly. A box that already has 22
  # or newer does not want a second copy from a different repository, and a
  # version manager's Node is invisible to systemd — install-units.sh refuses
  # on that, deliberately, rather than leaving a unit that cannot start.
  HAVE_NODE=$(command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' || echo 0)
  if [ "${HAVE_NODE:-0}" -ge "$NODE_MAJOR" ]; then
    say "node $(node --version) already present"
  else
    say "node is missing or older than $NODE_MAJOR — adding the NodeSource repository"
    run "curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x -o /tmp/nodesource_setup.sh"
    say "   (that script is downloaded, not piped to a shell — read /tmp/nodesource_setup.sh)"
    run "bash /tmp/nodesource_setup.sh"
    run "DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs"
  fi
else
  say "skipped"
fi

# ------------------------------------------------------------ user and dir
step "Service user and directory"
if id -u "$USER_NAME" >/dev/null 2>&1; then
  say "$USER_NAME already exists"
else
  run "adduser --system --group --home '$DIR' '$USER_NAME'"
fi
run "install -d -o '$USER_NAME' -g '$USER_NAME' '$DIR'"

# ------------------------------------------------------------- the code
step "The code"
HERE="$(cd "$(dirname "$0")" && pwd)"
# AN EXISTING CHECKOUT IS CHECKED FIRST, and left alone. This script installs;
# upgrading is ./contrib/deploy.sh, which fast-forwards, migrates and restarts
# in the right order. Copying over a live deployment would at best undo its
# version and at worst land a different .env on top of its own.
if [ -d "$DIR/.git" ]; then
  say "a checkout is already at $DIR — left alone"
  say "upgrade it with $DIR/contrib/deploy.sh, not with this script"
elif [ -f "$HERE/package.json" ] && [ "$HERE" != "$DIR" ]; then
  say "running from a checkout at $HERE — copying it rather than cloning again"
  # NOT .env AND NOT node_modules. The first is another deployment's secrets
  # and must not arrive here by a copy nobody asked for; the second is
  # reinstalled from the lockfile two lines down anyway.
  say "excluding .env and node_modules"
  run "tar -C '$HERE' --exclude=./node_modules --exclude=./.env -cf - . | tar -C '$DIR' -xf -"
  run "chown -R '$USER_NAME':'$USER_NAME' '$DIR'"
else
  run "sudo -u '$USER_NAME' git clone --branch '$REF' '$REPO' '$DIR'"
fi
run "cd '$DIR' && sudo -u '$USER_NAME' npm ci --omit=dev"

# --------------------------------------------------------------- database
step "PostgreSQL role and database"
if [ -z "$DB_PASSWORD" ]; then
  # Generated rather than prompted, so a non-interactive run works, and
  # printed once below because it has to go into .env by hand in the next
  # step. It is a local database password on this same box; the two secrets
  # that must never be seen are the encryption keys, and `npm run configure`
  # generates those itself and never prints them.
  DB_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)"
  GENERATED=1
fi
DB_URL="postgres://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"

if [ "$DRY" = 1 ]; then
  run "sudo -u postgres psql -c \"CREATE ROLE $DB_USER LOGIN PASSWORD '<generated>'\""
  run "sudo -u postgres createdb '$DB_NAME' -O '$DB_USER'"
else
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
    say "role $DB_USER already exists — not touching it or its password"
    GENERATED=
    DB_URL="postgres://${DB_USER}:<existing password>@localhost:5432/${DB_NAME}"
  else
    sudo -u postgres psql -q -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD'"
    say "created role $DB_USER"
  fi
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
    say "database $DB_NAME already exists"
  else
    sudo -u postgres createdb "$DB_NAME" -O "$DB_USER"
    say "created database $DB_NAME"
  fi
fi

# ------------------------------------------------------------------ hand over
echo
if [ "$DRY" = 1 ]; then
  echo "Nothing was changed. Drop --dry-run to do it."
  echo
  exit 0
fi

cat <<NEXT

== Done with the mechanical part. Three commands left, and they need you.

  cd $DIR

  1. sudo -u $USER_NAME npm run configure
NEXT
if [ -n "${GENERATED:-}" ]; then
  cat <<NEXT
     When it asks for the database, this is the line:

       $DB_URL

     That password was generated just now and is printed only here.
NEXT
fi
cat <<NEXT

     It also generates two encryption keys and writes them to .env. They are
     never displayed, and that file is the only place they exist. BACK IT UP,
     OFF THIS MACHINE, BEFORE YOU GO FURTHER — lose either key and the data
     behind it is unreadable forever, with the ciphertext intact in every
     backup you own.

  2. sudo -u $USER_NAME npm run migrate

  3. sudo -u $USER_NAME npm run set-curtain-password

     Without this the site is gated with no password set, which means nothing
     matches it and nobody gets in, including you.

Then, in order:

  sudo -u $USER_NAME npm run mail-test -- you@example.org
     Wait for it to arrive. Without working mail no report can be confirmed,
     and the sign-in code is only in the service log.

  sudo $DIR/contrib/install-units.sh
     The app, and the timers for the anchor, the backup, uploads and cleanup.

  sudo certbot --nginx -d your.hostname
     Then merge contrib/nginx/reportlog.conf into the block it writes — all
     seven location blocks and both includes. Five paths have to reach the
     app; INSTALL.md §3.14 says which and why one of them fails silently
     with a 200.

  sudo -u $USER_NAME npm run doctor
     It will tell you what is still missing, including whether the proxy is
     forwarding all five paths and whether the timers are enabled.

The full guide, including backups and what to do when a step fails:
  $DIR/INSTALL.md

NEXT
