#!/bin/bash
# Run Bugsink, the error tracker, on this server, and point the archive at it.
#
#   sudo /root/reportlog/deploy/install-bugsink.sh
#
# After install.sh. Safe to run again: every step checks before it changes
# anything. Run it again after deploy/bugsink/requirements.txt names a new
# Bugsink, to move to it.
#
# What it does, in order:
#   1. Python's venv module, the `bugsink` user and its directories
#   2. Bugsink $BUGSINK_VERSION into /opt/bugsink-<version>, every file checked
#      against the SHA-256 in deploy/bugsink/requirements.txt
#   3. /etc/bugsink: the settings (deploy/bugsink/bugsink_conf.py) and
#      bugsink.env with a SECRET_KEY made here
#   4. its own database: SQLite under /var/lib/bugsink, owned by `bugsink`
#   5. an administrator for Bugsink's own sign-in (asked)
#   6. a project for the archive, and ERROR_TRACKING_DSN in
#      /etc/reportlog/reportlog.env, pointing at 127.0.0.1:8000
#   7. its two services, and its domain in Caddy
#
# Bugsink is a second application with its own login. It runs as its own
# user, cannot read /etc/reportlog (0750, group reportlog), and keeps its
# data in its own files, not in the archive's PostgreSQL.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
# shellcheck source=versions.conf
. "$HERE/versions.conf"

BUGSINK_USER=bugsink
BUGSINK_ETC=/etc/bugsink
BUGSINK_STATE=/var/lib/bugsink
BUGSINK_VENV=/opt/bugsink-$BUGSINK_VERSION
BUGSINK_LINK=/opt/bugsink
BUGSINK_PORT=8000

require_root
[ -e "$ENV_FILE" ] || die "run install.sh first: $ENV_FILE does not exist."

# Bugsink's own management command, as its user, with its settings and keys.
# The keys come from its env file, read by the shell that runs the command,
# so they are never on a command line (where `ps` shows them).
BUGSINK_SHELL='set -a && . /etc/bugsink/bugsink.env && set +a && cd /var/lib/bugsink && exec "$@"'
bugsink_manage() {
  runuser -u "$BUGSINK_USER" -- env -i PATH=/usr/bin:/bin HOME="$BUGSINK_STATE" \
    PYTHONPATH="$BUGSINK_ETC" DJANGO_SETTINGS_MODULE=bugsink_conf \
    bash -c "$BUGSINK_SHELL" _ "$BUGSINK_LINK/bin/bugsink-manage" "$@"
}

# The same, with a password on standard input for Django's createsuperuser,
# which takes it from DJANGO_SUPERUSER_PASSWORD. The variable is set inside
# the shell that runs the command, never as an argument.
bugsink_manage_with_password() {
  local password=$1
  shift
  printf '%s\n' "$password" | runuser -u "$BUGSINK_USER" -- env -i PATH=/usr/bin:/bin \
    HOME="$BUGSINK_STATE" PYTHONPATH="$BUGSINK_ETC" DJANGO_SETTINGS_MODULE=bugsink_conf \
    bash -c "IFS= read -r DJANGO_SUPERUSER_PASSWORD && export DJANGO_SUPERUSER_PASSWORD && $BUGSINK_SHELL" \
    _ "$BUGSINK_LINK/bin/bugsink-manage" "$@"
}

say "Bugsink: its domain"
DOMAIN=$(env_value BUGSINK_DOMAIN "$DEPLOY_ENV")
if [ -z "$DOMAIN" ]; then
  site=$(env_value SITE_ORIGIN)
  site=${site#*://}
  site=${site%%/*}
  suggested=${site:+bugsink.$site}
  note "Bugsink needs a domain of its own, pointed at this server like the site's."
  DOMAIN=$(ask "Bugsink's domain${suggested:+ (Enter for $suggested)}")
  DOMAIN=${DOMAIN:-$suggested}
  printf '%s' "$DOMAIN" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' \
    || die "'$DOMAIN' is not a domain name. Nothing was installed."
  set_env BUGSINK_DOMAIN "$DOMAIN" "$DEPLOY_ENV"
fi
note "https://$DOMAIN"

say "1. Python, the bugsink user and its directories"
apt-get install -y -qq python3-venv >/dev/null
id "$BUGSINK_USER" >/dev/null 2>&1 \
  || useradd --system --user-group --home-dir "$BUGSINK_STATE" --no-create-home \
    --shell /usr/sbin/nologin "$BUGSINK_USER"
install -d -m 0750 -o "$BUGSINK_USER" -g "$BUGSINK_USER" "$BUGSINK_STATE"
install -d -m 0750 -o root -g "$BUGSINK_USER" "$BUGSINK_ETC"
note "user '$BUGSINK_USER', state in $BUGSINK_STATE"

say "2. Bugsink $BUGSINK_VERSION"
grep -qx "bugsink==$BUGSINK_VERSION \\\\" "$HERE/bugsink/requirements.txt" \
  || die "deploy/bugsink/requirements.txt does not pin bugsink==$BUGSINK_VERSION (versions.conf)."
if [ ! -x "$BUGSINK_VENV/bin/bugsink-manage" ]; then
  rm -rf "$BUGSINK_VENV"
  python3 -m venv "$BUGSINK_VENV"
  # Wheels only (nothing is compiled here), each file's hash checked, and
  # nothing installed that the requirements file does not name.
  if ! "$BUGSINK_VENV/bin/pip" install --quiet --disable-pip-version-check \
    --require-hashes --only-binary :all: --no-deps -r "$HERE/bugsink/requirements.txt"; then
    rm -rf "$BUGSINK_VENV"
    die "Bugsink could not be installed (above: usually a file whose hash did not match). Nothing was changed."
  fi
fi
ln -sfn "$BUGSINK_VENV" "$BUGSINK_LINK"
note "$BUGSINK_LINK -> $BUGSINK_VENV"

say "3. Settings"
install -m 0644 "$HERE/bugsink/bugsink_conf.py" "$BUGSINK_ETC/bugsink_conf.py"
install -m 0644 "$HERE/bugsink/bugsink.caddy" "$BUGSINK_ETC/bugsink.caddy"
if [ ! -e "$BUGSINK_ETC/bugsink.env" ]; then
  # Letters and digits only, so the file is safe for the shell that reads it.
  secret=$(head -c 96 /dev/urandom | base64 -w0 | tr -dc 'A-Za-z0-9')
  secret=${secret:0:64}
  printf '# Bugsink'"'"'s own keys. Made by deploy/install-bugsink.sh; never copied anywhere.\nSECRET_KEY=%s\nBUGSINK_BASE_URL=https://%s\n' \
    "$secret" "$DOMAIN" >"$BUGSINK_ETC/bugsink.env"
  note "made SECRET_KEY in $BUGSINK_ETC/bugsink.env"
else
  set_env BUGSINK_BASE_URL "https://$DOMAIN" "$BUGSINK_ETC/bugsink.env"
fi
chown root:"$BUGSINK_USER" "$BUGSINK_ETC/bugsink.env"
chmod 0640 "$BUGSINK_ETC/bugsink.env"

say "4. Its database"
bugsink_manage migrate --no-input -v0
bugsink_manage migrate snappea --database=snappea --no-input -v0
note "SQLite in $BUGSINK_STATE"

say "5. Bugsink's administrator"
admins=$(bugsink_manage shell -c "$(
  cat <<'PY'
from django.contrib.auth import get_user_model
print("HAS_ADMIN" if get_user_model().objects.filter(is_superuser=True).exists() else "NO_ADMIN")
PY
)")
if [[ $'\n'"$admins" == *$'\n'HAS_ADMIN* ]]; then
  note "an administrator exists"
else
  note "Bugsink has its own sign-in, separate from the site's."
  email=$(ask "An email address to sign in to Bugsink with")
  if [ -z "$email" ]; then
    note "No administrator yet. Run this script again to make one."
  else
    password=$(ask "A password for it (at least 12 characters)" secret)
    again=$(ask "The same password again" secret)
    [ "$password" = "$again" ] || die "the two passwords differ. Run this script again."
    [ "${#password}" -ge 12 ] || die "the password is shorter than 12 characters. Run this script again."
    bugsink_manage_with_password "$password" createsuperuser --no-input \
      --username "$email" --email "$email" </dev/null >/dev/null
    note "administrator $email made"
  fi
fi

say "6. A project for the archive"
if [ -n "$(env_value ERROR_TRACKING_DSN)" ]; then
  note "ERROR_TRACKING_DSN is already set; left as it is."
else
  # The DSN names the local port, not the domain: the API's events never
  # leave the machine, and do not depend on DNS or the certificate.
  found=$(bugsink_manage shell -c "$(
    cat <<'PY'
from teams.models import Team
from projects.models import Project
team, _ = Team.objects.get_or_create(name="ReportLog")
project = Project.objects.filter(slug="reportlog", is_deleted=False).first()
if project is None:
    project = Project.objects.create(name="ReportLog", slug="reportlog", team=team)
print("PROJECT", project.id, project.sentry_key.hex)
PY
  )" | sed -n 's/^PROJECT \([0-9][0-9]*\) \([0-9a-f]\{32\}\)$/\1 \2/p')
  [ -n "$found" ] || die "Bugsink did not make a project. Nothing in the archive's settings was changed."
  set_env ERROR_TRACKING_DSN "http://${found#* }@127.0.0.1:$BUGSINK_PORT/${found%% *}"
  note "ERROR_TRACKING_DSN set (project 'ReportLog')"
fi

say "7. Services and Caddy"
changed=0
for unit in bugsink.service bugsink-snappea.service; do
  if ! cmp -s "$HERE/bugsink/$unit" "$UNIT_DIR/$unit"; then
    install -m 0644 "$HERE/bugsink/$unit" "$UNIT_DIR/$unit"
    changed=1
  fi
done
[ "$changed" -eq 1 ] && systemctl daemon-reload
systemctl enable bugsink.service bugsink-snappea.service >/dev/null 2>&1
systemctl restart bugsink.service bugsink-snappea.service
up=""
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 -o /dev/null "http://127.0.0.1:$BUGSINK_PORT/accounts/login/"; then
    up=1
    break
  fi
  sleep 1
done
[ -n "$up" ] || die "Bugsink does not answer on 127.0.0.1:$BUGSINK_PORT. See: journalctl -u bugsink -n 50"
note "Bugsink answers on 127.0.0.1:$BUGSINK_PORT"

# The archive picks up its new DSN; a job picks it up the next time it runs.
systemctl try-restart reportlog-api.service || true

if [ -n "$(release_of "$CURRENT")" ]; then
  install_caddyfile "$(release_of "$CURRENT")"
else
  note "Nothing is deployed yet: the first deploy adds $DOMAIN to Caddy."
fi

say "Done."
cat <<EOF
  1. Point $DOMAIN's DNS (A and AAAA) at this server, as for the site.
  2. Sign in at https://$DOMAIN with the administrator above.
  3. The archive's errors arrive in the project "ReportLog".
EOF
