#!/bin/sh
# Mounted volumes are often root-owned; fix that, then drop to the unprivileged user.
set -e
mkdir -p /data && chown -R node:node /data
exec su-exec node "$@"
