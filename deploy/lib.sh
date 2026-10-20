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
BACKUP_DIR=/var/backups/reportlog
BUILD_HOME=/var/cache/reportlog-build
LIB=/usr/local/lib/reportlog
NODE=/usr/local/bin/node
KEEP_RELEASES=5
UNIT_DIR=/etc/systemd/system

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

  for f in "$src"/*.service "$src"/*.timer; do
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
  for f in "$UNIT_DIR"/reportlog-*.service "$UNIT_DIR"/reportlog-*.timer; do
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
  note "units installed ($(find "$src" -maxdepth 1 -name '*.timer' | wc -l) timers)"
}

# The Caddyfile a release carries, with this server's domain written in.
# Validated before it replaces the running one; reloaded only if it changed.
install_caddyfile() {
  local release=$1 origin domain acme bugsink tmp
  origin=$(env_value SITE_ORIGIN)
  [ -n "$origin" ] || die "SITE_ORIGIN is not set in $ENV_FILE. Caddy needs the domain."
  domain=${origin#*://}
  domain=${domain%%/*}
  acme=$(env_value ACME_EMAIL "$DEPLOY_ENV")

  bugsink=$(env_value BUGSINK_DOMAIN "$DEPLOY_ENV")

  tmp=$(mktemp)
  sed -e "s|@SITE_DOMAIN@|$domain|" \
    -e "s|@ACME_EMAIL_LINE@|${acme:+email $acme}|" \
    "$release/deploy/caddy/Caddyfile" >"$tmp"
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
update_check() {
  local repo ref cause="" err rc=0
  repo=$(env_value REPO_URL "$DEPLOY_ENV")
  ref=$(env_value DEPLOY_REF "$DEPLOY_ENV")
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
}
