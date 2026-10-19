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

release_of() { readlink -f "$1" 2>/dev/null || true; }

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
  local release=$1 origin domain acme tmp
  origin=$(env_value SITE_ORIGIN)
  [ -n "$origin" ] || die "SITE_ORIGIN is not set in $ENV_FILE. Caddy needs the domain."
  domain=${origin#*://}
  domain=${domain%%/*}
  acme=$(env_value ACME_EMAIL "$DEPLOY_ENV")

  tmp=$(mktemp)
  sed -e "s|@SITE_DOMAIN@|$domain|" \
    -e "s|@ACME_EMAIL_LINE@|${acme:+email $acme}|" \
    "$release/deploy/caddy/Caddyfile" >"$tmp"
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

# Make `release` the running one: units, Caddyfile, symlinks, restart.
# Returns non-zero if the API does not come up healthy on it.
activate() {
  local release=$1 was
  was=$(release_of "$CURRENT")
  install_units "$release"
  install_caddyfile "$release"
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
