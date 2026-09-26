#!/bin/sh
set -eu

container=docker_server_1
if [ "${1:-}" = "--container" ]; then
  container=${2:-}
  shift 2
fi

username=${1:-}
email=${2:-}
if [ -z "$container" ] || [ -z "$username" ] || [ -z "$email" ] || [ "${3:-}" ]; then
  echo 'Usage: docker/scripts/create-admin.sh [--container CONTAINER] USERNAME EMAIL' >&2
  exit 2
fi

if ! podman container exists "$container"; then
  echo "Container not found: $container" >&2
  exit 1
fi

printf 'New administrator password: ' >&2
stty -echo
trap 'stty echo' EXIT HUP INT TERM
IFS= read -r password
printf '\nConfirm password: ' >&2
IFS= read -r confirmation
stty echo
trap - EXIT HUP INT TERM
printf '\n' >&2

if [ "$password" != "$confirmation" ]; then
  echo 'Passwords do not match' >&2
  exit 1
fi
if [ "${#password}" -lt 6 ]; then
  echo 'Password must contain at least 6 characters' >&2
  exit 1
fi

printf '%s\n' "$password" | podman exec -i "$container" pnpm --filter @tescord/server exec tsx scripts/create-admin.ts "$username" "$email"
unset password confirmation
