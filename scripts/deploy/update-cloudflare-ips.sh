#!/usr/bin/env bash
set -euo pipefail

destination="${1:-/etc/nginx/snippets/cloudflare-real-ip.conf}"
temporary_file="$(mktemp)"
trap 'rm -f -- "$temporary_file"' EXIT

{
  printf '# Generated from Cloudflare published ranges. Do not edit by hand.\n'
  curl --fail --silent --show-error https://www.cloudflare.com/ips-v4 \
    | awk 'NF == 1 && $1 ~ /^[0-9.]+\/[0-9]+$/ { print "set_real_ip_from " $1 ";" }'
  curl --fail --silent --show-error https://www.cloudflare.com/ips-v6 \
    | awk 'NF == 1 && $1 ~ /^[0-9A-Fa-f:]+\/[0-9]+$/ { print "set_real_ip_from " $1 ";" }'
  printf 'real_ip_header CF-Connecting-IP;\n'
  printf 'real_ip_recursive on;\n'
} > "$temporary_file"

range_count="$(grep -c '^set_real_ip_from ' "$temporary_file")"
if (( range_count < 10 )); then
  printf 'Refusing to install an incomplete Cloudflare IP list (%s ranges).\n' "$range_count" >&2
  exit 1
fi

sudo install -D -m 0644 "$temporary_file" "$destination"
sudo nginx -t
sudo systemctl reload nginx
printf 'Installed %s trusted Cloudflare ranges in %s.\n' "$range_count" "$destination"
