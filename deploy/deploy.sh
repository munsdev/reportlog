#!/bin/bash
# Deploy a version of ReportLog.
#
#   sudo reportlog deploy            the branch this server follows: the one
#                                    last installed from on the Updates
#                                    screen, else DEPLOY_REF in
#                                    /etc/reportlog/deploy.env
#   sudo reportlog deploy <ref>      a branch, tag or commit
#
# A commit older than the database (one lacking a migration the database has
# applied) is refused before anything is unpacked. Older code is reached only
# by rolling back to a release the server keeps.
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
  local repo ref sha id dir was was_previous branch
  repo=$(env_value REPO_URL "$DEPLOY_ENV")
  ref=${1:-$(followed_ref)}
  [ -n "$repo" ] || die "REPO_URL is not set in $DEPLOY_ENV."
  [ -n "$ref" ] || die "no ref given and DEPLOY_REF is not set in $DEPLOY_ENV."

  say "Fetching $ref"
  fetch_mirror "$repo" || die "could not fetch $ref. What git said is above."
  sha=$(git -C "$MIRROR" rev-parse --verify --quiet "$ref^{commit}") \
    || die "$ref is not a branch, tag or commit in $repo."
  note "$ref is ${sha:0:12}"

  was=$(release_of "$CURRENT")
  if [ -n "$was" ] && [ "$(cat "$was/REVISION" 2>/dev/null)" = "$sha" ]; then
    note "Already running ${sha:0:12} ($(basename "$was")). Nothing to deploy."
    note "To restart it: sudo systemctl restart reportlog-api"
    exit 0
  fi

  # WHICH BRANCH IT CAME FROM, kept beside the release (BRANCH) for the
  # Updates screen. Told by the Updates request; else the ref named, when it
  # is a branch; else whichever followed or offered branch points at the
  # commit. A name that is not a plain branch of the mirror is not recorded.
  branch=${REPORTLOG_DEPLOY_BRANCH:-}
  if [ -z "$branch" ] && git -C "$MIRROR" show-ref --verify --quiet "refs/heads/$ref"; then
    branch=$ref
  fi
  [ -n "$branch" ] || branch=$(branch_of_commit "$sha")
  if ! [[ "$branch" =~ ^[A-Za-z0-9._/-]{1,100}$ ]] \
    || ! git -C "$MIRROR" show-ref --verify --quiet "refs/heads/$branch"; then
    branch=""
  fi

  # DEPLOYED BY ITS OWN SCRIPTS. If this version changes the deploy scripts,
  # install them first and start again with them, once: otherwise the old
  # scripts deploy it and the new ones only work from the deploy after. The
  # lock is handed on through exec (take_lock reopens it in the new run).
  if [ -z "${REPORTLOG_TOOLING_RENEWED:-}" ] && ! tooling_matches "$sha"; then
    say "This version changes the deploy scripts: installing them, then starting again"
    renew_tooling "$sha"
    exec env REPORTLOG_TOOLING_RENEWED=1 REPORTLOG_DEPLOY_BRANCH="$branch" "$LIB/deploy.sh" "$sha"
  fi

  # NEVER OLDER THAN THE DATABASE (lib.sh, older_than_database). After the
  # renewal above, so the scripts that ship with this version decide.
  local refusal
  if refusal=$(older_than_database "$sha" "$was"); then die "$refusal"; fi

  id="$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}"
  dir="$RELEASES/$id"
  say "Unpacking into $dir"
  install -d -m 0755 "$dir"
  git -C "$MIRROR" archive "$sha" | tar -x -C "$dir"
  echo "$sha" >"$dir/REVISION"
  [ -z "$branch" ] || echo "$branch" >"$dir/BRANCH"

  say "Installing dependencies and building the website"
  # As the service user, in its build home, so no package's install script
  # ever runs as root. Ownership goes back to root before anything runs it.
  chown -R "$APP_USER:$APP_USER" "$dir"
  # Then the build tools go: everything is removed and the production
  # dependencies alone are installed again from the local store (pnpm's
  # --prod on an existing install skips dev dependencies without deleting
  # them, which left Vite, TypeScript and Playwright in every release).
  if ! as_app sh -c "cd '$dir' && pnpm install --frozen-lockfile --reporter=silent \
      && pnpm --filter @reportlog/web build >/dev/null \
      && find . -name node_modules -type d -prune -exec rm -rf {} + \
      && pnpm install --frozen-lockfile --prod --offline --reporter=silent"; then
    chown -R root:root "$dir"
    mv "$dir" "$dir.failed"
    die "the build failed. Still running: $(running_name "$was"). Kept for inspection: $dir.failed"
  fi
  [ -f "$dir/apps/web/dist/index.html" ] || die "the build produced no apps/web/dist/index.html."
  chown -R root:root "$dir"
  chmod -R go-w "$dir"

  say "Migrating the database"
  if ! app_node "$dir/apps/api/src/db/migrate-cli.ts" 2>&1 | sed 's/^/  /'; then
    mv "$dir" "$dir.failed"
    die "migrations failed. The release was NOT switched; still running: $(running_name "$was").
  Each migration file runs in its own transaction, so the failing one left no
  trace. Any that applied before it are additive, and the running release
  works with them. Kept for inspection: $dir.failed"
  fi

  # The reporters' contact key is never rotated. The first deploy records
  # its fingerprint; a later deploy with a different key stops here, before
  # anything is switched (apps/api/src/jobs/contact-key.ts).
  if ! app_node "$dir/apps/api/src/jobs/cli.ts" contact-key 2>&1 | sed 's/^/  /'; then
    mv "$dir" "$dir.failed"
    die "CONTACT_KEY differs from the key this archive started with. Nothing was switched;
  still running: $(running_name "$was"). Put the original key back in $ENV_FILE."
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
  write_release_facts || true

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
