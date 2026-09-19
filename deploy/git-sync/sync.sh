#!/bin/sh
# Keeps /repo in sync with its git remote by pulling on a fixed interval.
# Runs inside a small sidecar container, alongside the main site container.
# It never rebuilds anything itself — it only updates files on disk. The
# main container's own file-watcher (watch.py) notices those changes and
# rebuilds the site, exactly as if someone had edited the files by hand.
set -e

REPO_DIR="${GIT_SYNC_REPO_DIR:-/repo}"
INTERVAL="${GIT_SYNC_INTERVAL:-60}"

# Needed because the repo is owned by a different user id than the one
# git runs as inside this container — otherwise git refuses to touch it.
git config --global --add safe.directory "$REPO_DIR"

echo "[git-sync] watching for upstream changes every ${INTERVAL}s"

while true; do
  cd "$REPO_DIR"
  BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

  if OUTPUT=$(git pull --ff-only 2>&1); then
    AFTER=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
    if [ "$BEFORE" != "$AFTER" ]; then
      echo "[git-sync] updated ${BEFORE} -> ${AFTER}"
    fi
    # else: pull succeeded, nothing new — stay quiet, don't spam the log
  else
    echo "[git-sync] pull failed, will retry in ${INTERVAL}s:"
    echo "$OUTPUT"
  fi

  sleep "$INTERVAL"
done
