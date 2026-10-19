#!/bin/bash
# Prepare a fresh Debian 12 or Ubuntu 24.04 server to run ReportLog.
#
#   git clone https://github.com/munsdev/reportlog.git /root/reportlog
#   sudo /root/reportlog/deploy/install.sh
#
# Safe to run again: every step checks before it changes anything, and an
# existing settings file is never overwritten. Run it again after changing
# deploy/versions.conf to move the server to the new pins.
#
# What it does, in order:
#   1. unattended security updates for the OS (and for PostgreSQL and Caddy)
#   2. PostgreSQL from the PostgreSQL project's apt repository, socket only
#   3. Node.js at the exact version in versions.conf, checked by SHA-256
#   4. Caddy from Caddy's apt repository
#   5. the `reportlog` user, the directories, the database and its role
#   6. /etc/reportlog/reportlog.env and deploy.env, from templates
#   7. the `reportlog` command
#
# It does not deploy any code: `sudo reportlog deploy` does that, once the
# settings are filled in.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
CHECKOUT="$(dirname "$HERE")"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
# shellcheck source=versions.conf
. "$HERE/versions.conf"

require_root
export DEBIAN_FRONTEND=noninteractive

. /etc/os-release
case "$ID:$VERSION_CODENAME" in
  debian:bookworm | ubuntu:noble) ;;
  *) die "this script supports Debian 12 (bookworm) and Ubuntu 24.04 (noble); this is $PRETTY_NAME." ;;
esac
case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 NODE_SHA256=$NODE_SHA256_X64 ;;
  aarch64) NODE_ARCH=arm64 NODE_SHA256=$NODE_SHA256_ARM64 ;;
  *) die "unsupported architecture $(uname -m)." ;;
esac

# A key fetched over HTTPS, accepted only if its fingerprint is the pinned one.
trusted_key() {
  local url=$1 fingerprint=$2 out=$3 tmp got
  tmp=$(mktemp -d)
  curl -fsSL "$url" -o "$tmp/key.asc"
  got=$(gpg --homedir "$tmp" --batch --with-colons --show-keys "$tmp/key.asc" 2>/dev/null \
    | awk -F: '$1 == "fpr" { print $10; exit }')
  [ "$got" = "$fingerprint" ] || die "the key at $url has fingerprint '$got', not the pinned $fingerprint."
  gpg --homedir "$tmp" --batch --dearmor -o "$tmp/key.gpg" "$tmp/key.asc"
  install -m 0644 "$tmp/key.gpg" "$out"
  rm -rf "$tmp"
}

say "1. Packages and unattended security updates"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git xz-utils age \
  unattended-upgrades apt-listchanges >/dev/null
install -m 0644 "$HERE/apt/20auto-upgrades" /etc/apt/apt.conf.d/20auto-upgrades
install -m 0644 "$HERE/apt/52reportlog-unattended-upgrades" /etc/apt/apt.conf.d/52reportlog-unattended-upgrades
systemctl enable --now unattended-upgrades.service >/dev/null 2>&1 || true
note "unattended-upgrades on (security updates daily; see deploy/apt/)"

say "2. PostgreSQL $POSTGRES_MAJOR"
trusted_key "$PGDG_KEY_URL" "$PGDG_KEY_FINGERPRINT" /usr/share/keyrings/pgdg.gpg
echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt $VERSION_CODENAME-pgdg main" \
  >/etc/apt/sources.list.d/pgdg.list
apt-get update -qq
apt-get install -y -qq "postgresql-$POSTGRES_MAJOR" "postgresql-client-$POSTGRES_MAJOR" >/dev/null
# Socket only. Nothing listens on a TCP port, public or otherwise; the
# application, the backup and the doctor all connect over the socket as the
# `reportlog` operating-system user (peer authentication, no password).
install -m 0644 "$HERE/postgres/reportlog.conf" "/etc/postgresql/$POSTGRES_MAJOR/main/conf.d/reportlog.conf"
systemctl restart "postgresql@$POSTGRES_MAJOR-main"
systemctl enable postgresql >/dev/null 2>&1
note "postgresql-$POSTGRES_MAJOR, listening on /var/run/postgresql only"

say "3. Node.js $NODE_VERSION"
NODE_DIR="/opt/node-v$NODE_VERSION-linux-$NODE_ARCH"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  tmp=$(mktemp -d)
  tarball="node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$tarball" -o "$tmp/$tarball"
  echo "$NODE_SHA256  $tmp/$tarball" | sha256sum -c --quiet - \
    || die "$tarball does not match the SHA-256 pinned in versions.conf. Nothing was installed."
  tar -xJf "$tmp/$tarball" -C /opt
  rm -rf "$tmp"
fi
for bin in node npm npx corepack; do ln -sfn "$NODE_DIR/bin/$bin" "/usr/local/bin/$bin"; done
# pnpm, at the version package.json names, fetched by corepack at build time.
corepack enable --install-directory /usr/local/bin pnpm
note "node $(/usr/local/bin/node --version) from $NODE_DIR"

say "4. Caddy"
trusted_key "$CADDY_KEY_URL" "$CADDY_KEY_FINGERPRINT" /usr/share/keyrings/caddy-stable-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" \
  >/etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq caddy >/dev/null
note "$(caddy version | cut -d' ' -f1)"

say "5. User, directories and database"
id "$APP_USER" >/dev/null 2>&1 \
  || useradd --system --user-group --home-dir "$STATE_DIR" --no-create-home \
    --shell /usr/sbin/nologin "$APP_USER"
install -d -m 0755 -o root -g root "$SRV" "$RELEASES"
install -d -m 0750 -o root -g "$APP_USER" "$ETC"
install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$STATE_DIR"
install -d -m 0700 -o "$APP_USER" -g "$APP_USER" "$BACKUP_DIR" "$BUILD_HOME"
runuser -u postgres -- psql -qtAc "SELECT 1 FROM pg_roles WHERE rolname = '$APP_USER'" | grep -q 1 \
  || runuser -u postgres -- createuser "$APP_USER"
runuser -u postgres -- psql -qtAc "SELECT 1 FROM pg_database WHERE datname = '$APP_USER'" | grep -q 1 \
  || runuser -u postgres -- createdb -O "$APP_USER" "$APP_USER"
note "database '$APP_USER' owned by role '$APP_USER' (peer authentication)"

say "6. Settings"
if [ ! -e "$ENV_FILE" ]; then
  # The documented template, with the one value this script knows.
  sed -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://$APP_USER@/$APP_USER?host=/var/run/postgresql|" \
    -e 's|^TEST_DATABASE_URL=|# TEST_DATABASE_URL=|' \
    "$CHECKOUT/.env.example" >"$ENV_FILE"
  note "wrote $ENV_FILE — fill it in before deploying"
else
  note "$ENV_FILE exists; left as it is"
fi
chown root:"$APP_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"
if [ ! -e "$DEPLOY_ENV" ]; then
  install -m 0644 "$HERE/deploy.env.example" "$DEPLOY_ENV"
  note "wrote $DEPLOY_ENV"
fi

say "7. The reportlog command"
install_tooling "$CHECKOUT"
note "/usr/local/bin/reportlog"

say "Done. Next:"
cat <<EOF
  1. Point the domain's DNS (A and AAAA) at this server.
  2. Fill in $ENV_FILE: SITE_ORIGIN, the EMAIL_ and SCALEWAY_ settings,
     and the BACKUP_ settings. Every setting is explained in the file.
  3. Check $DEPLOY_ENV (where code comes from).
  4. sudo reportlog deploy
  5. sudo reportlog doctor
EOF
