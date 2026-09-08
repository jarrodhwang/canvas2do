#!/usr/bin/env bash
set -euo pipefail

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_directory="$(CDPATH= cd -- "$script_directory/../.." && pwd)"
compose_file="${COMPOSE_FILE:-$repository_directory/deploy/compose.lightsail.yml}"
environment_file="${ENV_FILE:-$repository_directory/deploy/.env}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_directory="${1:-$repository_directory/backups/canvas-to-do-$timestamp}"
compose=(docker compose --env-file "$environment_file" -f "$compose_file")

umask 077
mkdir -p -- "$backup_directory"
backup_directory="$(CDPATH= cd -- "$backup_directory" && pwd)"

postgres_container="$("${compose[@]}" ps -q postgres)"
api_container="$("${compose[@]}" ps -q api)"
if [[ -z "$postgres_container" || -z "$api_container" ]]; then
  printf 'PostgreSQL and API must be running before backup.\n' >&2
  exit 1
fi

printf 'Exporting PostgreSQL...\n'
"${compose[@]}" exec -T postgres sh -ec \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6 --no-owner --no-privileges' \
  > "$backup_directory/postgres.dump"

key_volume="$(docker inspect "$api_container" --format \
  '{{range .Mounts}}{{if or (eq .Destination "/var/lib/canvas-to-do/data-protection-keys") (eq .Destination "/var/lib/incos-workspace/data-protection-keys")}}{{.Name}}{{end}}{{end}}')"
if [[ -z "$key_volume" ]]; then
  printf 'Could not resolve the API Data Protection key-ring mount.\n' >&2
  exit 1
fi

printf 'Exporting Data Protection keys...\n'
docker run --rm --read-only \
  -v "$key_volume:/keys:ro" \
  -v "$backup_directory:/backup" \
  alpine:3.22 \
  tar -C /keys -czf /backup/data-protection-keys.tar.gz .

{
  printf 'created_utc=%s\n' "$timestamp"
  printf 'compose_file=%s\n' "$compose_file"
  printf 'git_commit=%s\n' "$(git -C "$repository_directory" rev-parse HEAD 2>/dev/null || printf unknown)"
} > "$backup_directory/manifest.txt"

(
  cd "$backup_directory"
  sha256sum postgres.dump data-protection-keys.tar.gz manifest.txt > SHA256SUMS
)

printf 'Backup created at %s. Store it encrypted and off-server.\n' "$backup_directory"
