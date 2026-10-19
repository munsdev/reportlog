#!/bin/bash
# Runs when a Claude Code session opens in this repository. Gets a fresh cloud
# container to the point where every check can run: dependencies installed, a
# local PostgreSQL on a socket, a migrated development database, and a .env
# naming it. Prints a short briefing of the facts that go stale.
#
# Must be fast when warm and must never fail the session: every step may fail
# quietly, and the briefing says what is missing.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

# --- dependencies ------------------------------------------------------------
[ -d node_modules ] || pnpm install --frozen-lockfile >/dev/null 2>&1

# --- a local database, only if nothing is configured ------------------------
# A socket in /var/tmp rather than TCP, owned by the postgres user, so it
# works in a container where we are root and Postgres refuses to be.
PG_DIR=/var/tmp/rl-pg
PG_BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
if [ -n "$PG_BIN" ] && id postgres >/dev/null 2>&1; then
  if [ ! -d "$PG_DIR/data" ]; then
    mkdir -p "$PG_DIR/data" "$PG_DIR/run" && chown -R postgres "$PG_DIR"
    su postgres -c "$PG_BIN/initdb -D $PG_DIR/data -A trust -U postgres" >/dev/null 2>&1
  fi
  if ! "$PG_BIN/pg_isready" -h "$PG_DIR/run" -p 5446 >/dev/null 2>&1; then
    su postgres -c "$PG_BIN/pg_ctl -D $PG_DIR/data -o '-k $PG_DIR/run -p 5446 -c listen_addresses=' -l $PG_DIR/server.log start" >/dev/null 2>&1
    sleep 2
  fi
  if [ ! -f .env ]; then
    printf 'DATABASE_URL=postgres://postgres@/reportlog_dev?host=%s/run&port=5446\nTEST_DATABASE_URL=postgres://postgres@/postgres?host=%s/run&port=5446\n' "$PG_DIR" "$PG_DIR" > .env
  fi
  psql "host=$PG_DIR/run port=5446 user=postgres" -tAc "SELECT 1 FROM pg_database WHERE datname='reportlog_dev'" 2>/dev/null | grep -q 1 \
    || psql "host=$PG_DIR/run port=5446 user=postgres" -qc "CREATE DATABASE reportlog_dev" >/dev/null 2>&1
  pnpm --filter @reportlog/api -s db:migrate >/dev/null 2>&1
fi
# A development key for reporters' addresses, so filing works locally.
if [ -f .env ] && ! grep -q '^CONTACT_KEY=.' .env; then
  printf 'CONTACT_KEY=%s\n' "$(openssl rand -base64 32)" >> .env
fi
# And for files: a key, a directory to keep them in, and the worker inside the
# server, so attaching a photo works locally.
if [ -f .env ] && ! grep -q '^FILES_KEY=.' .env; then
  printf 'FILES_KEY=%s\nFILES_STORAGE=disk\nFILES_DIR=%s\nFILES_INLINE_WORKER=true\n' \
    "$(openssl rand -base64 32)" "$PWD/.files" >> .env
fi

# --- the briefing -------------------------------------------------------------
echo "=== ReportLog · session briefing ==="
echo "BRANCH    $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
DIRTY=$(git status --porcelain 2>/dev/null | wc -l)
[ "$DIRTY" -gt 0 ] && echo "UNCOMMITTED  $DIRTY file(s): someone may have left work behind"
if [ -n "$PG_BIN" ] && "$PG_BIN/pg_isready" -h "$PG_DIR/run" -p 5446 >/dev/null 2>&1; then
  echo "POSTGRES  up on $PG_DIR/run:5446 (see .env)"
else
  echo "POSTGRES  not running here. Set DATABASE_URL and TEST_DATABASE_URL in .env"
fi
[ -d node_modules ] && echo "DEPS      installed" || echo "DEPS      missing: run pnpm install"
echo
echo "Read CLAUDE.md first. Your workstream's folders are in docs/workstreams.md."
echo "Before pushing: pnpm check && pnpm test:db (and pnpm --filter @reportlog/web e2e for UI work)."
echo "===================================="
