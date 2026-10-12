#!/bin/sh
# Runs as root only long enough to copy the (read-only mounted) deploy key and
# known_hosts into a private place, then drops to the unprivileged user.
set -eu
mkdir -p /data
chown guides:guides /data
if [ -f /ssh/id_ed25519 ]; then
  install -d -m 700 -o guides -g guides /home/guides/.ssh
  install -m 600 -o guides -g guides /ssh/id_ed25519 /home/guides/.ssh/id_ed25519
  if [ -f /ssh/known_hosts ]; then
    install -m 644 -o guides -g guides /ssh/known_hosts /home/guides/.ssh/known_hosts
  fi
fi
exec gosu guides "$@"
