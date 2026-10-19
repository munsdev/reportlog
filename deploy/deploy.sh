#!/bin/bash
# Deploy a version of ReportLog.
#
#   sudo reportlog deploy            the branch named in /etc/reportlog/deploy.env
#   sudo reportlog deploy <ref>      a branch, tag or commit
#
# THE ORDER IS THE POINT. Everything that can fail happens before the running
# release is touched:
#
#   1. fetch the code and unpack it into a NEW release directory
#   2. install its dependencies and build the website, as the service user
#   3. run its migrations against the live database
#   4. only then: install its units and Caddyfile, switch `current`, restart
#   5. check the API answers; if it does not, switch back
#
# A failed build or a failed migration stops at that step with the old
# release still running and `current` untouched. That is safe because
# migrations are additive: the release still running works on the newer
# schema (docs: deploy/README.md, "Why rolling back is safe").
set -euo pipefail

main() {
  # shellcheck source=lib.sh
  . "$(dirname "$(readlink -f "$0")")/lib.sh"
  require_root
  take_lock

  [ -r "$DEPLOY_ENV" ] || die "$DEPLOY_ENV is missing. Run install.sh first."
  [ -r "$ENV_FILE" ] || die "$ENV_FILE is missing. Run install.sh first."
  local repo ref sha id dir was was_previous
  repo=$(env_value REPO_URL "$DEPLOY_ENV")
  ref=${1:-$(env_value DEPLOY_REF "$DEPLOY_ENV")}
  [ -n "$repo" ] || die "REPO_URL is not set in $DEPLOY_ENV."
  [ -n "$ref" ] || die "no ref given and DEPLOY_REF is not set in $DEPLOY_ENV."

  say "Fetching $ref"
  if [ ! -d "$MIRROR" ]; then
    git clone --quiet --mirror "$repo" "$MIRROR"
  else
    git -C "$MIRROR" remote set-url origin "$repo"
    git -C "$MIRROR" fetch --quiet --prune origin
  fi
  sha=$(git -C "$MIRROR" rev-parse --verify --quiet "$ref^{commit}") \
    || die "$ref is not a branch, tag or commit in $repo."
  note "$ref is ${sha:0:12}"

  was=$(release_of "$CURRENT")
  if [ -n "$was" ] && [ "$(cat "$was/REVISION" 2>/dev/null)" = "$sha" ]; then
    note "Already running ${sha:0:12} ($(basename "$was")). Nothing to deploy."
    note "To restart it: sudo systemctl restart reportlog-api"
    exit 0
  fi

  id="$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}"
  dir="$RELEASES/$id"
  say "Unpacking into $dir"
  install -d -m 0755 "$dir"
  git -C "$MIRROR" archive "$sha" | tar -x -C "$dir"
  echo "$sha" >"$dir/REVISION"

  say "Installing dependencies and building the website"
  # As the service user, in its build home, so no package's install script
  # ever runs as root. Ownership goes back to root before anything runs it.
  chown -R "$APP_USER:$APP_USER" "$dir"
  if ! as_app sh -c "cd '$dir' && pnpm install --frozen-lockfile --reporter=silent \
      && pnpm --filter @reportlog/web build >/dev/null \
      && pnpm install --frozen-lockfile --prod --offline --reporter=silent"; then
    chown -R root:root "$dir"
    mv "$dir" "$dir.failed"
    die "the build failed. Still running $(basename "${was:-nothing}"). Kept for inspection: $dir.failed"
  fi
  [ -f "$dir/apps/web/dist/index.html" ] || die "the build produced no apps/web/dist/index.html."
  chown -R root:root "$dir"
  chmod -R go-w "$dir"

  say "Migrating the database"
  if ! app_node "$dir/apps/api/src/db/migrate-cli.ts" 2>&1 | sed 's/^/  /'; then
    mv "$dir" "$dir.failed"
    die "migrations failed. The release was NOT switched; still running $(basename "${was:-nothing}").
  Each migration file runs in its own transaction, so the failing one left no
  trace. Any that applied before it are additive, and the running release
  works with them. Kept for inspection: $dir.failed"
  fi

  say "Switching to $id"
  was_previous=$(release_of "$PREVIOUS")
  if ! activate "$dir"; then
    journalctl -u reportlog-api.service -n 20 --no-pager 2>/dev/null | sed 's/^/    /' || true
    if [ -n "$was" ]; then
      say "The new release did not answer. Switching back to $(basename "$was")"
      activate "$was" || die "the old release did not come back either. Look at: journalctl -u reportlog-api"
      [ -n "$was_previous" ] && point "$PREVIOUS" "$was_previous"
      mv "$dir" "$dir.failed"
      die "deploy of ${sha:0:12} failed after switching; $(basename "$was") is running again.
  Its migrations stay applied (they are additive). Kept for inspection: $dir.failed"
    fi
    die "the first release did not answer on /api/health. Look at: journalctl -u reportlog-api"
  fi
  note "answering on /api/health"

  install_tooling "$dir"
  prune_releases

  say "Checking the deployment"
  app_node "$dir/apps/api/src/jobs/cli.ts" doctor || true

  say "Deployed ${sha:0:12} as $id"
  [ -n "$was" ] && note "To go back: sudo reportlog rollback   (to $(basename "$was"))"
  return 0
}

# Keep the newest few, and never the ones `current` or `previous` point at.
prune_releases() {
  local keep_a keep_b n=0 d
  keep_a=$(release_of "$CURRENT")
  keep_b=$(release_of "$PREVIOUS")
  # Names start with a UTC timestamp, so name order is age order. Failed
  # releases count too, and go the same way once they are old enough.
  for d in $(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort -r); do
    n=$((n + 1))
    if [ "$d" = "$keep_a" ] || [ "$d" = "$keep_b" ]; then continue; fi
    if [ "$n" -gt "$KEEP_RELEASES" ]; then rm -rf "$d"; fi
  done
}

main "$@"
