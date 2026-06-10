#!/bin/sh
set -e

mkdir -p /app/data

if [ "$(id -u)" = "0" ]; then
  if ! chown -R node:node /app/data; then
    echo "warning: could not chown /app/data; continuing with existing permissions" >&2
  fi

  if command -v runuser >/dev/null 2>&1; then
    exec runuser -u node -- "$@"
  fi

  exec su node -s /bin/sh -c 'exec "$@"' -- "$@"
fi

exec "$@"
