# Bugsink's settings on a ReportLog server. Installed as /etc/bugsink/bugsink_conf.py
# by deploy/install-bugsink.sh; edit this file, not the installed one (running the
# installer again puts this one back).
#
# Started from Bugsink's own `bugsink-create-conf --template=singleserver`, with
# what differs for this server marked. It holds NO secret: the two values that
# are this server's own come from /etc/bugsink/bugsink.env (root:bugsink, 0640),
# which the installer writes:
#
#   SECRET_KEY        made by the installer, once, from 50 random characters
#   BUGSINK_BASE_URL  https://<the Bugsink domain>
#
# Bugsink never reads /etc/reportlog/reportlog.env, and ReportLog never reads
# this: the two applications share a machine, not their keys.
import os

from bugsink.settings.default import *  # noqa: F401,F403
from bugsink.settings.default import DATABASES
from bugsink.conf_utils import deduce_allowed_hosts, eat_your_own_dogfood

SECRET_KEY = os.environ["SECRET_KEY"]

# Behind Caddy, which terminates TLS and says so in X-Forwarded-Proto.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
# DIFFERS: Bugsink's template trusts X-Real-IP, to record who sent each
# request. Caddy does not send it here and Bugsink is not told to look, so
# every request comes from 127.0.0.1 as far as Bugsink knows: no visitor's or
# operator's address is kept, the same rule as the archive's own logs.
USE_X_REAL_IP = False

# Its own database: SQLite files under /var/lib/bugsink, owned by the
# `bugsink` user, separate from the archive's PostgreSQL. Bugsink's guide
# recommends SQLite for a single server.
DATABASES["default"]["NAME"] = "/var/lib/bugsink/db.sqlite3"
DATABASES["snappea"]["NAME"] = "/var/lib/bugsink/snappea.sqlite3"

# DIFFERS: Bugsink does not report its own errors anywhere.
SENTRY_DSN = None
eat_your_own_dogfood(SENTRY_DSN)

TIME_ZONE = "UTC"

SNAPPEA = {
    "TASK_ALWAYS_EAGER": False,
    "NUM_WORKERS": 2,
    "PID_FILE": None,  # systemd keeps one foreman running (bugsink-snappea.service)
    "WAKEUP_CALLS_DIR": "/var/lib/bugsink/snappea/wakeup",
    "STATS_RETENTION_MINUTES": 60 * 24 * 7,
}

# DIFFERS: no email. Bugsink's alerts are for a screen somebody looks at; the
# archive's own alerts (a failed job, an update) already go to OPS_ALERT_EMAIL.
EMAIL_BACKEND = "bugsink.email_backends.QuietConsoleEmailBackend"
SERVER_EMAIL = DEFAULT_FROM_EMAIL = "Bugsink <bugsink@reportlog.invalid>"

CB_ANYBODY = "CB_ANYBODY"
CB_MEMBERS = "CB_MEMBERS"
CB_ADMINS = "CB_ADMINS"
CB_NOBODY = "CB_NOBODY"

BUGSINK = {
    "BASE_URL": os.environ["BUGSINK_BASE_URL"],
    "SITE_TITLE": "Bugsink for ReportLog",
    "SINGLE_USER": False,
    # DIFFERS: only an administrator adds people, and there is one team.
    "USER_REGISTRATION": CB_ADMINS,
    "USER_REGISTRATION_VERIFY_EMAIL": False,
    "SINGLE_TEAM": True,
    "TEAM_CREATION": CB_ADMINS,
    # DIFFERS: an error is kept 30 days. It is for fixing a bug, not a record.
    "MAX_EVENT_AGE_DAYS": 30,
    "INGEST_STORE_BASE_DIR": "/var/lib/bugsink/ingestion",
    # DIFFERS: as little as possible on screen.
    "MINIMIZE_INFORMATION_EXPOSURE": True,
    # DIFFERS: Bugsink sends an anonymous daily ping to bugsink.com unless told
    # not to. This server contacts nobody it does not have to.
    "PHONEHOME": False,
    # Webhook alerts may only go to hosts named here: none.
    "ALERTS_WEBHOOK_OUTBOUND_MODE": "allowlist_only",
    "ALERTS_WEBHOOK_ALLOW_LIST": [],
}

# The Bugsink domain, and 127.0.0.1: the archive's API sends its events
# straight to the local port (ERROR_TRACKING_DSN names 127.0.0.1:8000), so
# they never leave the machine and do not depend on DNS or the certificate.
ALLOWED_HOSTS = deduce_allowed_hosts(BUGSINK["BASE_URL"])
