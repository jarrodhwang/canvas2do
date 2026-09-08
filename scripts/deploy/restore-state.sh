#!/usr/bin/env bash
set -euo pipefail

if [[ "${ALLOW_STATE_RESTORE:-}" != "YES" ]]; then
  printf 'Restore replaces the target database and key ring. Re-run with ALLOW_STATE_RESTORE=YES.\n' >&2
  exit 1
fi

if [[ $# -ne 1 ]]; then
  printf 'Usage: ALLOW_STATE_RESTORE=YES %s /absolute/path/to/backup-directory\n' "$0" >&2
  exit 1
fi

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_directory="$(CDPATH= cd -- "$script_directory/../.." && pwd)"
compose_file="${COMPOSE_FILE:-$repository_directory/deploy/compose.lightsail.yml}"
environment_file="${ENV_FILE:-$repository_directory/deploy/.env}"
backup_directory="$(CDPATH= cd -- "$1" && pwd)"
compose=(docker compose --env-file "$environment_file" -f "$compose_file")

for required_file in postgres.dump data-protection-keys.tar.gz manifest.txt SHA256SUMS; do
  if [[ ! -f "$backup_directory/$required_file" ]]; then
    printf 'Backup is missing %s.\n' "$required_file" >&2
    exit 1
  fi
done

(
  cd "$backup_directory"
  sha256sum --check SHA256SUMS
)

printf 'Stopping application services...\n'
"${compose[@]}" stop frontend api migrate 2>/dev/null || true
"${compose[@]}" up -d --wait postgres

printf 'Replacing PostgreSQL data from the verified dump...\n'
"${compose[@]}" exec -T postgres sh -ec \
  'dropdb --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
"${compose[@]}" exec -T postgres sh -ec \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error' \
  < "$backup_directory/postgres.dump"

printf 'Replacing the Data Protection key ring...\n'
docker volume create canvas-to-do-data-protection-keys >/dev/null
api_uid="$(docker run --rm --entrypoint sh canvas-to-do-api:local -ec 'printf %s "$APP_UID"')"
docker run --rm \
  -e "KEY_UID=$api_uid" \
  -v canvas-to-do-data-protection-keys:/keys \
  -v "$backup_directory:/backup:ro" \
  alpine:3.22 \
  sh -ec 'find /keys -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -C /keys -xzf /backup/data-protection-keys.tar.gz; chown -R "$KEY_UID:$KEY_UID" /keys'

printf 'Applying schema migrations once, then starting the pre-built application...\n'
"${compose[@]}" up -d --force-recreate migrate api frontend
"${compose[@]}" ps
printf 'Restore complete. Verify https://%s/api/health/ready before changing DNS.\n' \
  "$(sed -n 's/^APP_DOMAIN=//p' "$environment_file" | tail -1)"
