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
#   6. /etc/reportlog/reportlog.env and deploy.env, from templates, with
#      the keys the machine makes itself (CONTACT_KEY, FILES_KEY, the
#      transparency log's deploy key)
#   7. the settings only a person knows, asked one at a time: the site's
#      address, the mail and backup accounts' keys. Enter skips one; running
#      the script again asks only what is still empty. Nobody edits the
#      settings file by hand, and no secret is ever typed on a command line.
#   8. the `reportlog` command
#
# Keys, passwords and tokens live in /etc/reportlog/reportlog.env and nowhere
# else (docs/decisions.md, "Keys and secrets"). This script never prints one.
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
apt-get install -y -qq ca-certificates curl gnupg git xz-utils age openssh-client \
  unattended-upgrades apt-listchanges >/dev/null
install -m 0644 "$HERE/apt/20auto-upgrades" /etc/apt/apt.conf.d/20auto-upgrades
install -m 0644 "$HERE/apt/52reportlog-unattended-upgrades" /etc/apt/apt.conf.d/52reportlog-unattended-upgrades
systemctl enable --now unattended-upgrades.service >/dev/null 2>&1 || true
note "unattended-upgrades on (security updates daily; see deploy/apt/)"

say "2. PostgreSQL $POSTGRES_MAJOR"
trusted_key "$PGDG_KEY_URL" "$PGDG_KEY_FINGERPRINT" /usr/share/keyrings/pgdg.gpg
echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt $VERSION_CODENAME-pgdg main" \
  >/etc/apt/sources.list.d/pgdg.list
install -m 0644 "$HERE/apt/reportlog-pgdg.pref" /etc/apt/preferences.d/reportlog-pgdg.pref
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
FRESH=""
if [ ! -e "$ENV_FILE" ]; then
  FRESH=1
  # The documented template, with the one value this script knows.
  # Behind Caddy, so one proxy hop: without it every visitor has Caddy's
  # address and the sign-in limits count the whole site as one person.
  sed -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://$APP_USER@/$APP_USER?host=/var/run/postgresql|" \
    -e 's|^TEST_DATABASE_URL=|# TEST_DATABASE_URL=|' \
    -e 's|^TRUST_PROXY=.*|TRUST_PROXY=1|' \
    -e 's|^# ATTACHMENTS_ENABLED=.*|ATTACHMENTS_ENABLED=false|' \
    "$CHECKOUT/.env.example" >"$ENV_FILE"
  note "wrote $ENV_FILE — fill it in before deploying"
else
  note "$ENV_FILE exists; left as it is"
fi

# The reporters' contact key: made here, once, by the machine, and never
# typed, chosen or changed by a person. Only when the file has none AND no
# deploy has recorded one: a server that lost its key must get the original
# back, not a new one (a deploy refuses a key that differs from the first).
NEW_KEY=""
if [ -z "$(env_value CONTACT_KEY)" ] && [ ! -e "$STATE_DIR/contact-key.sha256" ]; then
  NEW_KEY=$(head -c 32 /dev/urandom | base64)
  if grep -q '^CONTACT_KEY=' "$ENV_FILE"; then
    sed -i "s|^CONTACT_KEY=.*|CONTACT_KEY=$NEW_KEY|" "$ENV_FILE"
  else
    printf 'CONTACT_KEY=%s\n' "$NEW_KEY" >>"$ENV_FILE"
  fi
  note "made CONTACT_KEY (see below: copy it off this server)"
fi
chown root:"$APP_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"

# The files key: the same kind of key, for reporters' files, and the same
# rule. Made by the machine on a new settings file. On an existing file
# without one, it is made only when somebody says this server has never
# taken a file: a key made over one that was lost would leave every stored
# file unreadable.
if [ -z "$(env_value FILES_KEY)" ]; then
  make_files_key=$FRESH
  if [ -z "$make_files_key" ]; then
    note "FILES_KEY is empty. If this server has ever taken files, put the original key back instead."
    case "$(ask "Has this server never taken a file, so a new FILES_KEY is safe? (yes/no)")" in
      y | yes) make_files_key=1 ;;
    esac
  fi
  if [ -n "$make_files_key" ]; then
    set_env FILES_KEY "$(head -c 32 /dev/urandom | base64)"
    note "made FILES_KEY (copy it off this server with the contact key)"
  fi
fi

# The transparency log's deploy key: the anchor pushes the daily record
# with it (deploy/README.md, "Scheduled jobs"). Made here, never copied from
# anywhere; only its public half is shown, to be added to the log's
# repository as a deploy key with write access.
LOG_KEY=$STATE_DIR/transparency-log-key
if [ -z "$(env_value TRANSPARENCY_LOG_SSH_KEY)" ] && [ ! -e "$LOG_KEY" ]; then
  ssh-keygen -q -t ed25519 -N '' -C "reportlog anchor" -f "$LOG_KEY"
  chown "$APP_USER:$APP_USER" "$LOG_KEY" "$LOG_KEY.pub"
  chmod 0600 "$LOG_KEY"
  set_env TRANSPARENCY_LOG_SSH_KEY "$LOG_KEY"
  note "made the transparency log's deploy key ($LOG_KEY)"
fi

if [ ! -e "$DEPLOY_ENV" ]; then
  install -m 0644 "$HERE/deploy.env.example" "$DEPLOY_ENV"
  note "wrote $DEPLOY_ENV"
fi

say "7. What only you know"
note "Enter skips a question. Run this script again to answer it later."
note "Keys and passwords are not shown on screen while you type them."
URL='https://[A-Za-z0-9.-]+(:[0-9]+)?'
EMAIL='[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+'
UUID='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
TOKEN='[^[:space:]]{8,}'
BUCKET='[a-z0-9.-]{3,63}'

note "The site:"
ask_setting SITE_ORIGIN "The address people will reach the site at (https://reports.example.org)" \
  "$URL" "https:// and a domain"

note "Email (Scaleway Transactional Email; deploy/README.md, \"Email\"):"
ask_setting EMAIL_FROM_ADDRESS "The address mail is sent from, on your verified domain" "$EMAIL" "an email address"
ask_setting SCALEWAY_PROJECT_ID "The Scaleway project's ID" "$UUID" "a Scaleway ID (8-4-4-4-12)"
ask_setting SCALEWAY_SECRET_KEY "The Scaleway API key's secret key" "$UUID" "a Scaleway secret key (8-4-4-4-12)" secret
if [ -n "$(env_value SCALEWAY_SECRET_KEY)" ] && [ -n "$(env_value SCALEWAY_PROJECT_ID)" ] \
  && [ -n "$(env_value EMAIL_FROM_ADDRESS)" ] && [ "$(env_value EMAIL_TRANSPORT)" = off ]; then
  set_env EMAIL_TRANSPORT scaleway
  note "EMAIL_TRANSPORT set to scaleway."
fi
ask_setting OPS_ALERT_EMAIL "Who is emailed when a scheduled job fails" "$EMAIL" "an email address"
ask_setting ADMIN_EMAIL "Where a list's new entries go when the list names nobody" "$EMAIL" "an email address"

note "Off-site backups (deploy/README.md, \"Off-site backups\"):"
ask_setting BACKUP_AGE_RECIPIENTS "The age public key backups are encrypted to (age1..., made on another machine)" \
  'age1[0-9a-z]{58}([ ,]+age1[0-9a-z]{58})*' "an age public key (age1 and 58 more characters)"
ask_setting BACKUP_S3_ENDPOINT "The backup bucket's endpoint (https://fsn1.your-objectstorage.com)" "$URL" "https:// and a host"
# All five, or none: the rest are asked once there is somewhere to send to.
if [ -n "$(env_value BACKUP_S3_ENDPOINT)" ]; then
  region_from_endpoint BACKUP_S3_ENDPOINT BACKUP_S3_REGION
  ask_setting BACKUP_S3_REGION "Its region (fsn1)" '[a-z0-9-]+' "a region name"
  ask_setting BACKUP_S3_BUCKET "The bucket's name" "$BUCKET" "a bucket name"
  ask_setting BACKUP_S3_ACCESS_KEY_ID "The upload-only key's access key ID" "$TOKEN" "an access key ID" secret
  ask_setting BACKUP_S3_SECRET_ACCESS_KEY "Its secret access key" "$TOKEN" "a secret key" secret
fi

note "Storage for reporters' files (skip until a provider is chosen):"
ask_setting S3_ENDPOINT "The files storage endpoint (https://...)" "$URL" "https:// and a host"
if [ -n "$(env_value S3_ENDPOINT)" ]; then
  region_from_endpoint S3_ENDPOINT S3_REGION
  ask_setting S3_REGION "Its region" '[a-z0-9-]+' "a region name"
  ask_setting S3_BUCKET_STAGING "The bucket for files not yet sent" "$BUCKET" "a bucket name"
  ask_setting S3_BUCKET_EVIDENCE "The bucket for files with a report" "$BUCKET" "a bucket name"
  ask_setting S3_BUCKET_RENDITIONS "The bucket for re-encoded copies" "$BUCKET" "a bucket name"
  ask_setting S3_ACCESS_KEY "The files key's access key ID" "$TOKEN" "an access key ID" secret
  ask_setting S3_SECRET_KEY "Its secret key" "$TOKEN" "a secret key" secret
  if [ "$(env_value FILES_STORAGE)" != s3 ] && [ -n "$(env_value S3_SECRET_KEY)" ]; then
    set_env FILES_STORAGE s3
    set_env FILES_INLINE_WORKER false
    note "FILES_STORAGE set to s3."
  fi
fi

note "The transparency log (deploy/README.md, \"Scheduled jobs\"):"
ask_setting TRANSPARENCY_LOG_REMOTES "Where the daily record is pushed (git@host:you/log.git)" \
  '[^[:space:]]+' "a git address" secret

# What a working site still needs, by name, never by value.
MISSING=""
for key in SITE_ORIGIN EMAIL_FROM_ADDRESS SCALEWAY_PROJECT_ID SCALEWAY_SECRET_KEY OPS_ALERT_EMAIL \
  BACKUP_AGE_RECIPIENTS BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_BUCKET \
  BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
  [ -n "$(env_value "$key")" ] || MISSING="$MISSING $key"
done

say "8. The reportlog command"
install_tooling "$CHECKOUT"
note "/usr/local/bin/reportlog"

if [ -n "$NEW_KEY" ]; then
  say "COPY THE CONTACT KEY OFF THIS SERVER NOW"
  cat <<EOF
  Every reporter's address is encrypted under CONTACT_KEY in $ENV_FILE.
  It is not in the database backups, on purpose. If this server is lost
  and the key with it, every stored address is unreadable for good.
  Keep a copy somewhere that is not this server and not beside the
  backups (a password manager the operators share, for instance):

      sudo grep ^CONTACT_KEY= $ENV_FILE

  It is never changed: a deploy refuses to run with a different one.
EOF
fi

if [ -e "$LOG_KEY.pub" ]; then
  say "The transparency log's deploy key"
  cat <<EOF
  Add this public key to the transparency log's repository as a deploy key
  WITH WRITE ACCESS (the private half stays on this server):

      $(cat "$LOG_KEY.pub")
EOF
fi

say "Done. Next:"
if [ -n "$MISSING" ]; then
  note "Still empty:$MISSING."
  note "Run this script again to answer them; it asks for nothing else."
fi
cat <<EOF
  1. Point the domain's DNS (A and AAAA) at this server.
  2. Check $DEPLOY_ENV (where code comes from).
  3. sudo reportlog deploy
  4. sudo reportlog doctor
  5. Optional: error tracking with Bugsink, on this server:
     sudo $HERE/install-bugsink.sh
EOF
