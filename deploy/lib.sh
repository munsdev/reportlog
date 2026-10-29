# shellcheck shell=bash disable=SC2034
# Shared by install.sh, deploy.sh and rollback.sh. Sourced, never run.
# (SC2034: the paths below are used by the scripts that source this.)
#
# Every path the server layout uses is named here once:
#
#   /srv/reportlog/repo.git        a mirror of the repository, fetched on deploy
#   /srv/reportlog/releases/<id>   one directory per deploy, owned by root
#   /srv/reportlog/current         -> the release that is running
#   /srv/reportlog/previous        -> the release that ran before it
#   /etc/reportlog/reportlog.env   the application's settings (root:reportlog 0640)
#   /etc/reportlog/deploy.env      where code comes from, and the ACME email
#   /var/lib/reportlog             the application's own state
#   /var/backups/reportlog         local database dumps
#   /usr/local/lib/reportlog       the copy of these scripts that is run
#
# Releases are owned by root and read-only to the service: the application
# can never rewrite its own code, sandbox or no sandbox.

APP_USER=reportlog
SRV=/srv/reportlog
RELEASES=$SRV/releases
CURRENT=$SRV/current
PREVIOUS=$SRV/previous
MIRROR=$SRV/repo.git
ETC=/etc/reportlog
ENV_FILE=$ETC/reportlog.env
DEPLOY_ENV=$ETC/deploy.env
STATE_DIR=/var/lib/reportlog
# The admin panel's Update button writes here (as the service user), and
# root reports back in STATUS_DIR. See run_update_request.
REQUEST_DIR=$STATE_DIR/update-request
STATUS_DIR=$STATE_DIR/update-status
BACKUP_DIR=/var/backups/reportlog
BUILD_HOME=/var/cache/reportlog-build
LIB=/usr/local/lib/reportlog
NODE=/usr/local/bin/node
KEEP_RELEASES=5
UNIT_DIR=/etc/systemd/system
# The branch this server follows, once somebody installed from one on the
# Updates screen. Root's file, never the application's: the screen may only
# ask. Absent until then, which means DEPLOY_REF. See followed_ref.
FOLLOW_FILE=$SRV/follow
# The only branches the Updates screen may name (decided by the owner). A
# server can still follow another one through DEPLOY_REF; it just cannot be
# asked for by name.
OFFERED_BRANCHES="main beta alpha"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die() {
  printf '\n\033[1;31mSTOPPED:\033[0m %s\n\n' "$*" >&2
  exit 1
}

require_root() {
  [ "$(id -u)" -eq 0 ] || die "run this as root (with sudo)."
}

# One deploy or rollback at a time. Two at once would race on the symlink.
take_lock() {
  exec 9>/run/reportlog-deploy.lock
  flock -n 9 || die "another deploy or rollback is running."
}

# A setting from the application's env file, without sourcing it: the file
# is node's format, not the shell's, and sourcing would execute it.
env_value() {
  local key=$1 file=${2:-$ENV_FILE}
  [ -r "$file" ] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# Write one setting into an env file: replaces the `KEY=` line, or the
# commented `# KEY=` placeholder the template has for it, or adds a line.
# The file keeps its owner and mode (it is rewritten in place). The value
# reaches awk through its environment, never its arguments, so a secret is
# not on a command line where `ps` would show it, and no character in it is
# special.
set_env() {
  local key=$1 value=$2 file=${3:-$ENV_FILE} out
  out=$(KEY="$key" VALUE="$value" awk '
    BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"]; done = 0 }
    !done && (index($0, k "=") == 1 || index($0, "# " k "=") == 1) { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$file")
  printf '%s\n' "$out" >"$file"
}

# One answer from whoever runs the script, read from standard input. Empty
# when nobody answers: no terminal and nothing piped in reads as end of
# input, so an unattended run asks nothing and carries on. A secret is not
# echoed while it is typed. The question goes to standard error.
ask() {
  local question=$1 kind=${2:-plain} answer=""
  printf '  %s: ' "$question" >&2
  if [ "$kind" = secret ] && [ -t 0 ]; then
    IFS= read -r -s answer || true
    printf '\n' >&2
  else
    IFS= read -r answer || true
    [ -t 0 ] || printf '\n' >&2
  fi
  printf '%s' "$answer"
}

# Ask for a setting that is still empty in the env file, check its shape,
# and write it. Enter (or no answer at all) leaves it empty for later:
# running the installer again asks only what is still missing.
#
#   ask_setting KEY "question" <extended regex> "what it looks like" [secret]
ask_setting() {
  local key=$1 question=$2 shape=$3 hint=$4 kind=${5:-plain} value tries=0
  [ -z "$(env_value "$key")" ] || return 0
  while [ "$tries" -lt 3 ]; do
    value=$(ask "$question" "$kind")
    [ -n "$value" ] || {
      note "$key left empty for now."
      return 0
    }
    if printf '%s' "$value" | grep -Eq "^($shape)\$"; then
      set_env "$key" "$value"
      note "$key set."
      return 0
    fi
    note "That does not look like $hint. Try again, or press Enter to skip."
    tries=$((tries + 1))
  done
  note "$key left empty for now."
}

# The region an S3-compatible endpoint's address already names, or nothing
# when it does not (an address of your own, say): the installer then asks.
#   https://fsn1.your-objectstorage.com -> fsn1
#   https://s3.nl-ams.scw.cloud         -> nl-ams
#   https://s3.eu-central-1.amazonaws.com -> eu-central-1
region_of_endpoint() {
  local host=${1#*://}
  host=${host%%/*}
  host=${host%%:*}
  case "$host" in
    s3.*.scw.cloud) host=${host#s3.}; printf '%s' "${host%.scw.cloud}" ;;
    s3.*.amazonaws.com) host=${host#s3.}; printf '%s' "${host%.amazonaws.com}" ;;
    *.your-objectstorage.com) printf '%s' "${host%%.*}" ;;
  esac
}

# Fill REGION_KEY from ENDPOINT_KEY's address when that names a region, so
# nobody is asked for what the address already says (and cannot type a
# region that disagrees with it by accident). Does nothing once the region
# has a value.
region_from_endpoint() {
  local endpoint_key=$1 region_key=$2 region
  [ -z "$(env_value "$region_key")" ] || return 0
  region=$(region_of_endpoint "$(env_value "$endpoint_key")")
  [ -n "$region" ] || return 0
  set_env "$region_key" "$region"
  note "$region_key set to $region, read off the endpoint."
}

# Run something as the service user with a clean environment. Used for the
# build (so package install scripts never run as root) and for anything
# that executes the application's code.
as_app() {
  runuser -u "$APP_USER" -- env -i \
    HOME="$BUILD_HOME" \
    PATH=/usr/local/bin:/usr/bin:/bin \
    COREPACK_HOME="$BUILD_HOME/corepack" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true \
    ${HTTPS_PROXY:+HTTPS_PROXY="$HTTPS_PROXY"} \
    ${NO_PROXY:+NO_PROXY="$NO_PROXY"} \
    ${NODE_EXTRA_CA_CERTS:+NODE_EXTRA_CA_CERTS="$NODE_EXTRA_CA_CERTS"} \
    "$@"
}
# (The three proxy settings pass through only if root has them, for a server
# that reaches the internet through a proxy. On most servers they are unset.)

# The application's node, with its settings, as the service user.
app_node() {
  as_app "$NODE" --env-file="$ENV_FILE" "$@"
}

# Where a link points, or nothing if it does not exist. `-e`, not `-f`: -f
# answers with the link's own path when the link is missing, which reads as
# "a release called current is running" on a server that has never deployed.
release_of() { readlink -e "$1" 2>/dev/null || true; }

# "release <id>", or a sentence for a server with nothing deployed yet.
running_name() {
  if [ -n "$1" ]; then echo "release $(basename "$1")"; else echo "nothing (this was the first deploy)"; fi
}

# Point a symlink somewhere new in one rename, so there is no moment where
# `current` is missing or half-written.
point() {
  local link=$1 target=$2
  ln -sfn "$target" "$link.new"
  mv -T "$link.new" "$link"
}

# Install the systemd units a release carries, and remove ReportLog units the
# release no longer has. Run on EVERY deploy and rollback: a release that
# adds a timer must install it, or the code arrives and the schedule never
# does (that happened to the old application, twice).
install_units() {
  local release=$1 src="$1/deploy/systemd" f name changed=0
  [ -d "$src" ] || die "$release has no deploy/systemd directory."

  for f in "$src"/*.service "$src"/*.timer "$src"/*.path; do
    [ -e "$f" ] || continue
    name=$(basename "$f")
    if ! cmp -s "$f" "$UNIT_DIR/$name"; then
      install -m 0644 "$f" "$UNIT_DIR/$name"
      changed=1
    fi
  done
  for f in "$src"/*.service.d/*.conf; do
    [ -e "$f" ] || continue
    name="$(basename "$(dirname "$f")")/$(basename "$f")"
    if ! cmp -s "$f" "$UNIT_DIR/$name"; then
      install -D -m 0644 "$f" "$UNIT_DIR/$name"
      changed=1
    fi
  done

  # Units this release does not carry: stopped, disabled, removed.
  for f in "$UNIT_DIR"/reportlog-*.service "$UNIT_DIR"/reportlog-*.timer "$UNIT_DIR"/reportlog-*.path; do
    [ -e "$f" ] || continue
    name=$(basename "$f")
    if [ ! -e "$src/$name" ]; then
      note "removing $name (not in this release)"
      systemctl disable --now "$name" >/dev/null 2>&1 || true
      rm -f "$f"
      changed=1
    fi
  done
  for f in "$UNIT_DIR"/reportlog-*.service.d/*.conf; do
    [ -e "$f" ] || continue
    name="$(basename "$(dirname "$f")")/$(basename "$f")"
    [ -e "$src/$name" ] || { rm -f "$f"; changed=1; }
  done

  [ "$changed" -eq 1 ] && systemctl daemon-reload
  systemctl enable reportlog-api.service >/dev/null 2>&1
  for f in "$src"/*.timer; do
    [ -e "$f" ] || continue
    systemctl enable --now "$(basename "$f")" >/dev/null 2>&1 \
      || note "WARNING: could not enable $(basename "$f")"
  done
  # The admin panel's Update button: a path unit watching for its request,
  # in a directory that is the service user's to write and nobody else's.
  install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$REQUEST_DIR"
  for f in "$src"/*.path; do
    [ -e "$f" ] || continue
    systemctl enable --now "$(basename "$f")" >/dev/null 2>&1 \
      || note "WARNING: could not enable $(basename "$f")"
  done
  note "units installed ($(find "$src" -maxdepth 1 -name '*.timer' | wc -l) timers)"
}

# The Caddyfile a release carries, with this server's domain written in.
# Validated before it replaces the running one; reloaded only if it changed.
install_caddyfile() {
  local release=$1 origin domain acme aliases bugsink tmp
  origin=$(env_value SITE_ORIGIN)
  [ -n "$origin" ] || die "SITE_ORIGIN is not set in $ENV_FILE. Caddy needs the domain."
  domain=${origin#*://}
  domain=${domain%%/*}
  acme=$(env_value ACME_EMAIL "$DEPLOY_ENV")
  # Spaces or commas between names; Caddy wants "a, b". Checked here because
  # each name goes into sed and then into the Caddyfile as it is.
  aliases=$(env_value SITE_ALIASES "$DEPLOY_ENV" | tr ',' ' ' | xargs)
  aliases=${aliases// /, }
  if [ -n "$aliases" ] && ! [[ "$aliases" =~ ^[A-Za-z0-9.-]+(,\ [A-Za-z0-9.-]+)*$ ]]; then
    die "SITE_ALIASES in $DEPLOY_ENV is not a list of domain names: $aliases"
  fi

  bugsink=$(env_value BUGSINK_DOMAIN "$DEPLOY_ENV")

  tmp=$(mktemp)
  sed -e "s|@SITE_DOMAIN@|$domain|" \
    -e "s|@ACME_EMAIL_LINE@|${acme:+email $acme}|" \
    "$release/deploy/caddy/Caddyfile" >"$tmp"
  # The site's other names, redirected to it. From the release, so an older
  # release without the template keeps serving the one name it knew.
  if [ -n "$aliases" ]; then
    if [ -r "$release/deploy/caddy/aliases.caddy" ]; then
      { echo; sed -e "s|@SITE_ALIASES@|$aliases|" -e "s|@SITE_DOMAIN@|$domain|" \
        "$release/deploy/caddy/aliases.caddy"; } >>"$tmp"
    else
      note "WARNING: SITE_ALIASES is set but this release cannot redirect them."
    fi
  fi
  # Bugsink's site, on its own domain, when this server runs it. Taken from
  # what install-bugsink.sh installed, not from the release, so a rollback to
  # a release older than Bugsink does not take its site down.
  if [ -n "$bugsink" ]; then
    if [ -r /etc/bugsink/bugsink.caddy ]; then
      { echo; sed -e "s|@BUGSINK_DOMAIN@|$bugsink|" /etc/bugsink/bugsink.caddy; } >>"$tmp"
    else
      note "WARNING: BUGSINK_DOMAIN is set but Bugsink is not installed (deploy/install-bugsink.sh)."
    fi
  fi
  if cmp -s "$tmp" /etc/caddy/Caddyfile; then
    rm -f "$tmp"
    note "Caddyfile unchanged"
    return 0
  fi
  if ! caddy validate --adapter caddyfile --config "$tmp" >/dev/null 2>&1; then
    caddy validate --adapter caddyfile --config "$tmp" 2>&1 | tail -5 | sed 's/^/    /'
    rm -f "$tmp"
    die "the release's Caddyfile does not validate. Nothing was switched."
  fi
  install -m 0644 "$tmp" /etc/caddy/Caddyfile
  rm -f "$tmp"
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
  note "Caddyfile installed and Caddy reloaded"
}

# Is the API answering? Up to 30 seconds, on the port it was told to use.
api_healthy() {
  local port
  port=$(env_value PORT)
  port=${port:-3000}
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Make `release` the running one: Caddyfile, units, symlinks, restart.
# Returns non-zero if the API does not come up healthy on it.
#
# The Caddyfile first: it is the step that can refuse ("does not validate.
# Nothing was switched"), and it must refuse before this release's units are
# installed, or the running release is left under the new release's timers.
activate() {
  local release=$1 was
  was=$(release_of "$CURRENT")
  install_caddyfile "$release"
  install_units "$release"
  point "$CURRENT" "$release"
  if [ -n "$was" ] && [ "$was" != "$release" ]; then point "$PREVIOUS" "$was"; fi
  systemctl restart reportlog-api.service
  api_healthy
}

# The scripts root actually runs are a copy outside any release, refreshed
# from the release that was just activated. Running deploy.sh out of the
# release it is replacing is how a script ends up half old and half new.
install_tooling() {
  local release=$1
  install -d -m 0755 "$LIB"
  install -m 0755 "$release"/deploy/{deploy.sh,rollback.sh,install.sh} "$LIB/"
  install -m 0644 "$release"/deploy/{lib.sh,versions.conf} "$LIB/"
  install -m 0755 "$release/deploy/bin/reportlog" /usr/local/bin/reportlog
}

# THE SAME SCRIPTS, OR NOT? Root's copy against the ones commit $1 carries,
# read straight out of the mirror. A deploy runs root's copy, so a release
# that changes these scripts would otherwise be deployed by the OLD ones and
# only take effect at the deploy after (how the Update button's watcher went
# uninstalled on a test server, 23 October).
tooling_matches() {
  local sha=$1 f
  for f in deploy.sh rollback.sh install.sh lib.sh versions.conf; do
    git -C "$MIRROR" show "$sha:deploy/$f" 2>/dev/null | cmp -s - "$LIB/$f" || return 1
  done
  git -C "$MIRROR" show "$sha:deploy/bin/reportlog" 2>/dev/null | cmp -s - /usr/local/bin/reportlog
}

# Install commit $1's scripts as root's copy, straight from the mirror.
renew_tooling() {
  local sha=$1 tmp
  tmp=$(mktemp -d)
  git -C "$MIRROR" archive "$sha" deploy | tar -x -C "$tmp"
  install_tooling "$tmp"
  rm -rf "$tmp"
}

# Fetch the repository into the mirror: the only place code is fetched from.
# Bounded, so a hung remote cannot hold the deploy lock forever.
fetch_mirror() {
  local repo=$1
  if [ ! -d "$MIRROR" ]; then
    timeout 300 git clone --quiet --mirror "$repo" "$MIRROR"
  else
    git -C "$MIRROR" remote set-url origin "$repo" \
      && timeout 300 git -C "$MIRROR" fetch --quiet --prune origin
  fi
}

# Is $1 one of the branches the Updates screen may name? Exact words only.
is_offered_branch() {
  local b
  for b in $OFFERED_BRANCHES; do [ "$1" = "$b" ] && return 0; done
  return 1
}

# The ref this server checks and deploys by default: the branch last
# installed from on the Updates screen, or DEPLOY_REF. The file is root's,
# but it is read as strictly as if it were not.
followed_ref() {
  local b
  b=$(head -n 1 "$FOLLOW_FILE" 2>/dev/null || true)
  if is_offered_branch "$b"; then
    echo "$b"
  else
    env_value DEPLOY_REF "$DEPLOY_ENV"
  fi
}

# Follow branch $1 from now on (one of OFFERED_BRANCHES), in one rename.
set_follow() {
  is_offered_branch "$1" || return 1
  printf '%s\n' "$1" >"$FOLLOW_FILE.new"
  chmod 0644 "$FOLLOW_FILE.new"
  mv -f "$FOLLOW_FILE.new" "$FOLLOW_FILE"
}

# The branch commit $1 came from, for the record a release keeps (BRANCH):
# the followed ref if its tip is that commit, else the first offered branch
# whose tip is, else nothing. A guess only when nobody said; deploy.sh is
# told whenever the Updates screen asked.
branch_of_commit() {
  local sha=$1 b
  for b in "$(followed_ref)" $OFFERED_BRANCHES; do
    [ -n "$b" ] || continue
    if [ "$(git -C "$MIRROR" rev-parse --verify --quiet "refs/heads/$b^{commit}" 2>/dev/null)" = "$sha" ]; then
      echo "$b"
      return 0
    fi
  done
}

# NEVER INSTALL ANYTHING OLDER THAN THE DATABASE. The migrations the
# database has applied that commit $1 does not carry, one per line; nothing
# when it carries them all. Asked of the database, through the running
# release $2 (as the service user). A release too old to answer is replaced
# by its own migrations folder, which the database has at least applied.
#
# The migration runner would refuse such a commit too ("migrated by a newer
# version"), but only after a build of several minutes, leaving a failed
# release behind. This says so before anything is unpacked.
migrations_missing() {
  local sha=$1 was=$2 applied
  [ -n "$was" ] || return 0
  if ! applied=$(app_node "$was/apps/api/src/jobs/cli.ts" applied-migrations 2>/dev/null); then
    applied=$(ls "$was/apps/api/migrations" 2>/dev/null || true)
  fi
  printf '%s\n' "$applied" | grep -E '^[0-9]{14}_[a-z0-9_]+\.sql$' | LC_ALL=C sort -u \
    | LC_ALL=C comm -23 - <(git -C "$MIRROR" ls-tree --name-only "$sha" apps/api/migrations/ \
      | sed 's|.*/||' | LC_ALL=C sort -u)
}

# The sentence that refuses commit $1 when it is older than the database
# (running release $2), and success; or failure, saying nothing, when it is not.
older_than_database() {
  local missing n
  missing=$(migrations_missing "$1" "$2" || true)
  [ -n "$missing" ] || return 1
  n=$(printf '%s\n' "$missing" | wc -l)
  printf '%s\n' "Not installed: ${1:0:12} is older than this site's database. The database already has $(printf '%s\n' "$missing" | head -n 1)$([ "$n" -gt 1 ] && printf ' and %s more' "$((n - 1))"), which that version does not, so it would run older code than its database. To go back to older code on purpose, roll back to a release this server keeps."
  return 0
}

# Why a fetch failed, as one word, from git's error text on standard input
# (ported from legacy updateCheck.js). Only the word is ever kept: git's own
# text can contain the repository's address, and an address can carry a
# token. apps/api/src/jobs/updates.ts has a sentence for each word.
classify_fetch_failure() {
  local text
  text=$(tr '[:upper:]' '[:lower:]')
  case "$text" in
    *"could not read username"* | *"could not read password"* | *"terminal prompts disabled"* \
      | *"authentication failed"* | *"permission denied"* | *"invalid username or password"* \
      | *"repository not found"* | *" 403"*)
      echo auth ;;
    *"could not resolve host"* | *"name or service not known"* \
      | *"temporary failure in name resolution"*)
      echo dns ;;
    *"connection refused"* | *"connection timed out"* | *"network is unreachable"* \
      | *"unable to access"*)
      echo network ;;
    *) echo unknown ;;
  esac
}

# What the update check found, as plain files in $out for the application to
# read (apps/api/src/jobs/updates.ts). DISPLAY ONLY: nothing reads these to
# decide what to deploy. Written to a new directory and swapped in, so a
# reader never sees half of one check and half of another.
#
#   write_update_facts <mirror> <ref> <running release dir or ""> <out> [fetch failure cause]
write_update_facts() {
  local mirror=$1 ref=$2 release=$3 out=$4 cause=${5:-} tmp cur tip
  tmp=$(mktemp -d "$out.new.XXXXXX")
  date -u +%Y-%m-%dT%H:%M:%SZ >"$tmp/checked_at"
  printf '%s\n' "$ref" >"$tmp/ref"
  [ -z "$cause" ] || printf '%s\n' "$cause" >"$tmp/fetch_failed"
  cur=$(cat "$release/REVISION" 2>/dev/null || true)
  tip=$(git -C "$mirror" rev-parse --verify --quiet "$ref^{commit}" 2>/dev/null || true)
  printf '%s\n' "$cur" >"$tmp/current"
  printf '%s\n' "$tip" >"$tmp/tip"
  if [ -n "$tip" ]; then
    git -C "$mirror" show "$tip:package.json" >"$tmp/package-tip.json" 2>/dev/null \
      || rm -f "$tmp/package-tip.json"
    git -C "$mirror" show "$tip:CHANGELOG.md" >"$tmp/changelog-tip.md" 2>/dev/null \
      || rm -f "$tmp/changelog-tip.md"
    # Counted only when the running commit is in the mirror's history; a
    # release deployed from elsewhere has no meaningful distance.
    if [ -n "$cur" ] && git -C "$mirror" cat-file -e "$cur^{commit}" 2>/dev/null; then
      git -C "$mirror" show "$cur:package.json" >"$tmp/package-current.json" 2>/dev/null \
        || rm -f "$tmp/package-current.json"
      git -C "$mirror" rev-list --count "$cur..$tip" >"$tmp/behind"
      git -C "$mirror" rev-list --count "$tip..$cur" >"$tmp/ahead"
      git -C "$mirror" log --no-merges --format='%h %s' -n 100 "$cur..$tip" >"$tmp/commits"
    fi
  fi
  chmod 0755 "$tmp"
  chmod 0644 "$tmp"/*
  # The state directory is the service user's. -T: if something put a
  # symlink where $out goes, the rename fails rather than following it.
  rm -rf "$out"
  mv -T "$tmp" "$out"
}

# `reportlog updates`: fetch the mirror as root (with root's credentials, as
# a deploy does) and write what it found under the state directory. Never
# deploys anything. A failed fetch still writes the facts, from the mirror as
# it was, with the cause.
#
#   update_check [branch]   against the followed ref, or one offered branch
update_check() {
  local repo ref cause="" err rc=0
  repo=$(env_value REPO_URL "$DEPLOY_ENV")
  ref=${1:-$(followed_ref)}
  [ -n "$repo" ] || die "REPO_URL is not set in $DEPLOY_ENV."
  [ -n "$ref" ] || die "DEPLOY_REF is not set in $DEPLOY_ENV."
  # No prompt: in a timer there is nobody to type a password, and a prompt
  # would wait out the whole timeout instead of failing at once.
  err=$(GIT_TERMINAL_PROMPT=0 fetch_mirror "$repo" 2>&1 >/dev/null) || rc=$?
  if [ "$rc" -eq 124 ]; then
    cause=timeout
  elif [ "$rc" -ne 0 ]; then
    cause=$(printf '%s' "$err" | classify_fetch_failure)
  fi
  [ -d "$MIRROR" ] || cause=${cause:-unknown}
  [ -d "$STATE_DIR" ] || install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$STATE_DIR"
  if [ -d "$MIRROR" ]; then
    write_update_facts "$MIRROR" "$ref" "$(release_of "$CURRENT")" "$STATE_DIR/updates" "$cause"
  else
    write_update_facts /nonexistent "$ref" "" "$STATE_DIR/updates" "$cause"
  fi
  write_release_facts
}

# What is installed, what the server follows, and the releases it keeps,
# as plain files under STATE_DIR/installed for the Updates screen
# (apps/api/src/site/updateRoutes.ts). DISPLAY ONLY, like the update facts:
# a rollback request names a release, and root checks that name against
# $RELEASES itself. Written after every check, deploy and rollback.
#
#   following   the followed ref
#   current     the running release's id; previous, the one before it
#   releases    one line per kept release, newest first:
#               <id> <commit> <branch or -> <version or ->
write_release_facts() {
  local out="$STATE_DIR/installed" tmp d b v
  [ -d "$STATE_DIR" ] || return 0
  tmp=$(mktemp -d "$out.new.XXXXXX")
  followed_ref >"$tmp/following"
  d=$(release_of "$CURRENT")
  [ -z "$d" ] || basename "$d" >"$tmp/current"
  d=$(release_of "$PREVIOUS")
  [ -z "$d" ] || basename "$d" >"$tmp/previous"
  : >"$tmp/releases"
  # Names start with a UTC time, so name order is age order. Failed
  # releases are not release points: they never ran.
  for d in $(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -name '*.failed' 2>/dev/null | LC_ALL=C sort -r); do
    [ -f "$d/REVISION" ] || continue
    b=$(head -n 1 "$d/BRANCH" 2>/dev/null || true)
    v=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([0-9][0-9.]*\)".*/\1/p' "$d/package.json" 2>/dev/null | head -n 1)
    printf '%s %s %s %s\n' "$(basename "$d")" "$(head -c 40 "$d/REVISION")" "${b:--}" "${v:--}" >>"$tmp/releases"
  done
  chmod 0755 "$tmp"
  chmod 0644 "$tmp"/*
  rm -rf "$out"
  mv -T "$tmp" "$out"
}

# The request's status, written whole (rename) so the panel never reads
# half of one.
#   update_status <state> <action> [sha] [branch] [release]
update_status() {
  local tmp
  tmp=$(mktemp "$STATUS_DIR/.status.XXXXXX")
  printf 'state=%s\naction=%s\nsha=%s\nbranch=%s\nrelease=%s\nat=%s\n' "$1" "$2" "${3:-}" \
    "${4:-}" "${5:-}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$STATUS_DIR/status"
}

# The value of `<key>=` in request text $1 when it has exactly the shape $3
# (an extended regex, anchored here); nothing when the key is absent; and
# "!" when it is there with any other value, or more than once, which
# refuses the whole request. A value that does not match is never trimmed
# or guessed at.
request_field() {
  local text=$1 key=$2 shape=$3 line value="" found=0
  while IFS= read -r line; do
    case "$line" in "$key="*) ;; *) continue ;; esac
    if [ "$found" -eq 1 ]; then
      echo '!'
      return 0
    fi
    found=1
    value=${line#"$key="}
    if ! [[ "$value" =~ ^($shape)$ ]]; then
      echo '!'
      return 0
    fi
  done <<<"$text"
  printf '%s' "$value"
}

# THE UPDATE BUTTON. The admin panel writes $REQUEST_DIR/request as the
# service user; reportlog-update-request.path sees it and runs this as root,
# so nobody needs a shell, sudo or ssh to update the site.
#
# THE FILE IS UNTRUSTED: anything that can run as the service user can write
# it. It is read once, from a plain file (never through a link), at most
# 4 KB, and each value must have an exact shape or the request is refused:
#
#   action=check   [branch=<b>]    run the update check now, against the
#                                  followed ref, or against branch <b>
#   action=apply   sha=<40 hex>    deploy ONLY the commit the followed ref,
#                  [branch=<b>]    or branch <b>, points at after a fresh
#                                  fetch. Any other sha is refused.
#                                  Installing from <b> makes the server
#                                  follow <b> from then on.
#   action=rollback [release=<id>] one step back while `previous` is older
#                                  than what runs; or to release <id>, which
#                                  must be the exact name of a release
#                                  directory this server keeps.
#
# <b> is one of OFFERED_BRANCHES, compared word for word, and reaches git
# only as refs/heads/<b>. <id> has the shape deploy.sh names releases with.
# Nothing from the file reaches a shell unquoted.
#
# An apply is also refused when the commit is older than the database
# (older_than_database): only a rollback goes to older code, on purpose.
# The deploy is the ordinary one: it migrates, switches, checks the new
# release answers, and switches back if it does not.
run_update_request() {
  local req="$REQUEST_DIR/request" text="" action sha branch release ref tip rc=0 \
    log="$STATUS_DIR/log"
  [ -e "$req" ] || [ -L "$req" ] || return 0
  if [ -f "$req" ] && [ ! -L "$req" ]; then text=$(head -c 4096 "$req" || true); fi
  # Removed before anything runs, so a request runs once even if it fails
  # and the path unit does not start it again.
  rm -f "$req"
  install -d -m 0755 "$STATUS_DIR"
  action=$(request_field "$text" action 'check|apply|rollback')
  sha=$(request_field "$text" sha '[0-9a-f]{40}')
  branch=$(request_field "$text" branch "${OFFERED_BRANCHES// /|}")
  release=$(request_field "$text" release '[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}')
  : >"$log"
  chmod 0644 "$log"
  if [ -z "$action" ] || [ "$action" = '!' ]; then
    echo "The request was not one this server accepts, so nothing was done." >>"$log"
    update_status refused unknown
    return 0
  fi
  # Each action takes only its own fields, so nothing is quietly ignored.
  if [ "$sha" = '!' ] || [ "$branch" = '!' ] || [ "$release" = '!' ] \
    || { [ "$action" = check ] && [ -n "$sha$release" ]; } \
    || { [ "$action" = apply ] && { [ -z "$sha" ] || [ -n "$release" ]; }; } \
    || { [ "$action" = rollback ] && [ -n "$sha$branch" ]; }; then
    echo "The request was not one this server accepts, so nothing was done. The branches it can be asked for are: $OFFERED_BRANCHES." >>"$log"
    update_status refused "$action"
    return 0
  fi
  exec 8>/run/reportlog-deploy.lock
  if ! flock -n 8; then
    echo "A deploy is already running. Try again when it has finished." >>"$log"
    update_status refused "$action" "$sha" "$branch" "$release"
    return 0
  fi
  update_status running "$action" "$sha" "$branch" "$release"
  # ROLLBACK needs no network, so it comes before the fetch. The database
  # keeps what the newer release added; older code runs on it.
  if [ "$action" = rollback ]; then
    local now_id back_id d found=""
    now_id=$(basename "$(release_of "$CURRENT")")
    if [ -n "$release" ]; then
      # A NAMED RELEASE (the Updates screen's release points): the exact name
      # of a directory this server keeps, never a path built from the file.
      for d in "$RELEASES"/*; do
        if [ "$(basename "$d")" = "$release" ] && [ -d "$d" ] && [ ! -L "$d" ] && [ -f "$d/REVISION" ]; then
          found=$release
        fi
      done
      if [ -z "$found" ]; then
        echo "This server keeps no release called $release, so there is nothing to go back to. Reload the page to see the ones it keeps." >>"$log"
        update_status refused "$action" "" "" "$release"
        return 0
      fi
      if [ "$found" = "$now_id" ]; then
        echo "Release $release is the one running already." >>"$log"
        update_status refused "$action" "" "" "$release"
        return 0
      fi
    else
      # ONCE, THEN IT STAYS. Release ids start with their UTC time, so a
      # rollback is allowed only while `previous` is OLDER than what is
      # running. After one rollback `previous` is the newer release it left,
      # so a second request would only go forward again: refused. A new
      # deploy makes `previous` older again. (The terminal command
      # `reportlog rollback` still toggles.)
      back_id=$(basename "$(release_of "$PREVIOUS")")
      if [ -z "$back_id" ] || [ "$back_id" = "$now_id" ] \
        || [ "$(printf '%s\n%s\n' "$back_id" "$now_id" | LC_ALL=C sort | head -n 1)" != "$back_id" ]; then
        echo "There is nothing older to go back to. The site has already been rolled back, or this is its first release. To move forward, install an update." >>"$log"
        update_status refused "$action"
        return 0
      fi
    fi
    exec 8>&-
    "$LIB/rollback.sh" ${found:+"$found"} >>"$log" 2>&1 || rc=$?
    write_release_facts >/dev/null 2>&1 || true
    if [ "$rc" -eq 0 ]; then
      update_status "done" "$action" "" "" "$release"
    else
      update_status failed "$action" "" "" "$release"
    fi
    return 0
  fi
  update_check "$branch" >>"$log" 2>&1 || rc=$?
  if [ "$action" = apply ] && [ "$rc" -eq 0 ]; then
    # An offered branch is named in full, so a tag of the same name never
    # answers for it.
    if [ -n "$branch" ]; then ref="refs/heads/$branch"; else ref=$(followed_ref); fi
    tip=$(git -C "$MIRROR" rev-parse --verify --quiet "$ref^{commit}" 2>/dev/null || true)
    if [ -z "$tip" ]; then
      echo "There is no branch called ${branch:-$ref} on the repository, so there is nothing to install from it." >>"$log"
      update_status refused "$action" "$sha" "$branch"
      return 0
    fi
    if [ "$sha" != "$tip" ]; then
      echo "What is on offer changed since the page was loaded. Reload it and try again." >>"$log"
      update_status refused "$action" "$sha" "$branch"
      return 0
    fi
    if older_than_database "$sha" "$(release_of "$CURRENT")" >>"$log"; then
      update_status refused "$action" "$sha" "$branch"
      return 0
    fi
    # The deploy takes the same lock itself, so let go of it first. It is
    # told the branch, so the release records where it came from.
    exec 8>&-
    REPORTLOG_DEPLOY_BRANCH="$branch" "$LIB/deploy.sh" "$sha" >>"$log" 2>&1 || rc=$?
    if [ "$rc" -eq 0 ] && [ -n "$branch" ] && [ "$branch" != "$(followed_ref)" ]; then
      set_follow "$branch"
      echo "From now on this server follows $branch: its checks, the daily one too, look there." >>"$log"
    fi
    update_check >/dev/null 2>&1 || true
  fi
  if [ "$rc" -eq 0 ]; then
    update_status "done" "$action" "$sha" "$branch"
  else
    update_status failed "$action" "$sha" "$branch"
  fi
}
