# AWS Lightsail production deployment

This runbook deploys Canvas To Do on one Ubuntu 24.04 Lightsail instance behind
Cloudflare. The host NGINX process is the only public application entry point.

```text
Browser -> Cloudflare HTTPS -> host NGINX :443
                               |-> frontend 127.0.0.1:8080
                               `-> Kestrel  127.0.0.1:5000 -> PostgreSQL (Docker network only)
```

The Compose definition is [`deploy/compose.lightsail.yml`](deploy/compose.lightsail.yml).
It does not publish PostgreSQL, and both published application ports are explicitly
bound to loopback. Do not add public Lightsail rules for 5000, 5432, or 8080.

## Minimum instance

Use the **1 GB RAM / 2 vCPU / 40 GB SSD** general-purpose IPv4 bundle as the practical
minimum. The 512 MB bundle does not leave a dependable safety margin for Ubuntu,
Docker, PostgreSQL, .NET, NGINX, backups, and package upgrades. The deployment sets
steady-state ceilings of 384 MB for the API, 256 MB for PostgreSQL, and 64 MB for the
static frontend. The one-shot migrator runs before the API, so their peak budgets do
not overlap.

Add 2 GB of swap as an emergency buffer, not as normal working memory:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Move to the 2 GB bundle if memory stays above 80%, swap is used during ordinary
requests, a container is OOM-killed, or concurrent Canvas requests become sluggish.

## 1. Prepare Lightsail and Ubuntu

Attach a Lightsail static IPv4 address. Allow inbound TCP 80 and 443. Allow TCP 22
only from the administrator's IP address where practical. Install NGINX, Certbot,
Git, and Docker Engine with its Compose plugin from Docker's official Ubuntu
repository:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git nginx certbot python3-certbot-nginx
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in after the group change. Enable unattended security updates and
reboot when Ubuntu indicates that a kernel restart is required.

## 2. Configure the application

Clone the repository, then create the ignored production environment file:

```bash
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
openssl rand -base64 36
```

Put the generated value in `POSTGRES_PASSWORD`. Replace every `example.com`, set
`APP_DOMAIN`, SMTP, OAuth, and Canvas values, and remove the bootstrap administrator
password after the first successful administrator sign-in. Keep
`CANVAS_MANUAL_TOKEN_ENABLED=false` unless manual tokens are an explicit deployment
decision.

Validate and build images one at a time to avoid build-time memory spikes:

```bash
docker compose --env-file deploy/.env -f deploy/compose.lightsail.yml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.lightsail.yml build api
docker compose --env-file deploy/.env -f deploy/compose.lightsail.yml build frontend
docker compose --env-file deploy/.env -f deploy/compose.lightsail.yml up -d
docker compose --env-file deploy/.env -f deploy/compose.lightsail.yml ps -a
```

Compose waits for PostgreSQL, runs the migrator to completion, then starts Kestrel
and the static frontend. A failed migration prevents the API from starting.

## 3. Configure NGINX and TLS

Initially create the Cloudflare DNS A record with proxying disabled so Certbot can
validate the origin. Point `@` to the Lightsail static IPv4 and set `www` as a CNAME
to the root domain.

Install the temporary HTTP site, replace `example.com`, and obtain a Let's Encrypt
certificate:

```bash
sudo cp deploy/nginx/bootstrap.conf.example /etc/nginx/sites-available/canvas-to-do
sudoedit /etc/nginx/sites-available/canvas-to-do
sudo ln -s /etc/nginx/sites-available/canvas-to-do /etc/nginx/sites-enabled/canvas-to-do
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --nginx -d example.com -d www.example.com
```

Generate the trusted Cloudflare real-IP list before installing the final site. This
prevents a direct client from spoofing `CF-Connecting-IP`:

```bash
sudo scripts/deploy/update-cloudflare-ips.sh
sudo cp deploy/nginx/canvas-to-do.conf.example /etc/nginx/sites-available/canvas-to-do
sudoedit /etc/nginx/sites-available/canvas-to-do
sudo nginx -t
sudo systemctl reload nginx
```

Replace `example.com` in the site file first. Test the origin over HTTPS, then enable
Cloudflare's orange-cloud proxy and set SSL/TLS mode to **Full (strict)**. Do not add
a Cloudflare cache rule for `/api/*`; authenticated API responses intentionally use
`Cache-Control: no-store`. Hashed frontend assets use one-year immutable caching.

For the strongest origin isolation, allow current Cloudflare IP ranges to ports
80/443 at the host firewall and reject other sources. Keep the real-IP script on a
monthly timer because Cloudflare can add ranges before using them.

## 4. Move existing data

The database and ASP.NET Data Protection key ring are one backup unit. The key ring
is required to decrypt stored Canvas tokens and existing cookies. On the source
machine, while its API and PostgreSQL containers are running:

```bash
scripts/deploy/backup-state.sh
```

If the source still uses the root production Compose stack, select it explicitly:

```bash
COMPOSE_FILE="$PWD/docker-compose.yml" ENV_FILE="$PWD/.env" scripts/deploy/backup-state.sh
```

The output directory is mode-restricted and contains a PostgreSQL custom-format dump,
the key ring, metadata, and SHA-256 checksums. It contains sensitive account data;
copy it through SSH and keep it encrypted off-server.

On the new server, configure `deploy/.env` and build both images first. Then restore:

```bash
ALLOW_STATE_RESTORE=YES scripts/deploy/restore-state.sh /absolute/path/to/canvas-to-do-BACKUP
curl --fail https://example.com/api/health/ready
```

Restore deliberately requires an explicit environment flag because it replaces the
target database and key ring. It verifies checksums before changing state, applies
new schema migrations once, and starts the application only after migration succeeds.
Do not delete the source instance or change DNS until login, grades, Canvas access,
and manual Academy data have been verified.

## Updates, backups, and checks

For an application update, take a backup, pull code, build images sequentially, and
recreate the migration/API/frontend services:

```bash
scripts/deploy/backup-state.sh
git pull --ff-only
docker compose --env-file deploy/.env -f deploy/compose.lightsail.yml build api
docker compose --env-file deploy/.env -f deploy/compose.lightsail.yml build frontend
docker compose --env-file deploy/.env -f deploy/compose.lightsail.yml up -d --force-recreate migrate api frontend
```

Also enable Lightsail automatic snapshots, but retain logical PostgreSQL plus key-ring
backups for portable restores. Regularly check:

```bash
docker compose --env-file deploy/.env -f deploy/compose.lightsail.yml ps -a
docker stats --no-stream
free -h
df -h
curl --fail https://example.com/api/health
curl --fail https://example.com/api/health/ready
```

Exercise a restore on a staging instance before treating backups as reliable. Never
run `docker compose down -v`; the explicit volume names are
`canvas-to-do-postgres-data` and `canvas-to-do-data-protection-keys`.

## Primary references

- [AWS Lightsail bundle specifications](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html)
- [Lightsail firewall rules](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.html)
- [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Docker Compose startup conditions](https://docs.docker.com/compose/how-tos/startup-order/)
- [Official PostgreSQL image and PostgreSQL 18 volume layout](https://hub.docker.com/_/postgres)
- [Cloudflare Full (strict) TLS](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)
- [Cloudflare origin IP ranges](https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/)
