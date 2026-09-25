#!/bin/sh
set -eu

# Keep schema deployment in the API startup path so a one-shot Compose
# migration container cannot become a stale Podman dependency after restart.
if ! pnpm --filter @tescord/server db:migrate:deploy; then
  sleep 5
  exit 1
fi

exec pnpm --filter @tescord/server start
