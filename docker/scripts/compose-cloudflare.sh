#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
docker_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
compose_file="$docker_dir/docker-compose-cloudflare.yml"
env_file="$docker_dir/.env.cloudflare"

if [ ! -f "$env_file" ]; then
  printf 'Cloudflare environment file is missing: %s\n' "$env_file" >&2
  exit 1
fi

exec podman-compose -f "$compose_file" --env-file "$env_file" "$@"
