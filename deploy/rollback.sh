#!/bin/bash
# Go back to the release that ran before this one.
#
#   sudo reportlog rollback            to the release `previous` points at
#   sudo reportlog rollback <id>       to a named one in /srv/reportlog/releases
#   sudo reportlog releases            to see which there are
#
# It switches `current` and restarts. It does NOT touch the database: the
# migrations the newer release applied stay applied, and the older code runs
# on them, which works because migrations only ever add (deploy/README.md,
# "Why rolling back is safe"). Rolling back twice returns to where you were.
set -euo pipefail

main() {
  # shellcheck source=lib.sh
  . "$(dirname "$(readlink -f "$0")")/lib.sh"
  require_root
  take_lock

  local target was
  was=$(release_of "$CURRENT")
  if [ $# -gt 0 ]; then
    target="$RELEASES/$1"
  else
    target=$(release_of "$PREVIOUS")
    [ -n "$target" ] || die "there is no previous release to go back to."
  fi
  [ -f "$target/REVISION" ] || die "$target is not a release."
  [[ "$target" != *.failed ]] || die "$target is a release that failed to deploy."
  [ "$target" != "$was" ] || die "$(basename "$target") is already running."

  say "Rolling back from $(basename "${was:-nothing}") to $(basename "$target")"
  if ! activate "$target"; then
    journalctl -u reportlog-api.service -n 20 --no-pager 2>/dev/null | sed 's/^/    /' || true
    die "$(basename "$target") did not answer on /api/health. \`current\` points at it now;
  to return to the release you came from: sudo reportlog rollback $(basename "$was")"
  fi
  note "answering on /api/health"

  # The tooling follows the running release, so the next deploy is run by
  # the scripts this release shipped with.
  install_tooling "$target"

  say "Running $(basename "$target") ($(cut -c1-12 "$target/REVISION"))"
  note "The database keeps the newer release's migrations; that is expected."
  note "To undo this rollback: sudo reportlog rollback"
}

main "$@"
