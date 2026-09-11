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
sudo apt install -y ca-certificates curl git nginx openssl snapd
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

Install Certbot using its officially recommended Snap package rather than relying on
optional Ubuntu repository components:

```bash
sudo systemctl enable --now snapd.socket
sudo snap wait system seed.loaded
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/local/bin/certbot
certbot --version
```

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

### Canvas onboarding and school branding

Canvas token reminders default to enabled and wait for the signed-in user's saved
preferences and token status. Users can dismiss a reminder for the current session,
or disable **Canvas token reminders** in Settings → Canvas connection and save.
The same section opens the screenshot guide and token entry form at any time.
Existing explicit title-bar expansion preferences are preserved; new accounts
start collapsed. **Show school logo** defaults to enabled and can be saved off.

Automatic school logos come from Canvas's public `/api/v1/brand_variables` endpoint,
only after a Canvas connection exists. These requests omit credentials and never
include the access token. Failed branding/image loads leave the app icon visible.
The bundled nginx policies allow connections to Instructure and CloudFront, and
HTTPS school images. When enabling a Canvas instance on a custom domain, add its
exact origin (and its branding JSON redirect origin, if different) to `connect-src`
in both `frontend/nginx.conf` and `deploy/nginx/frontend.conf`. That institution
must also permit cross-origin access to its public branding JSON. This keeps
arbitrary external fetches restricted without proxying external URLs through the API.

Guide screenshots are bundled locally; attribution and source URLs are in
`frontend/public/guide/canvas/README.md`. Verify onboarding logic with
`npm run test:onboarding --prefix frontend`.

The Canvas setup school dropdown is generated from the API's allowed instance URLs.
The bundled defaults include 20 verified North American and South Korean university Canvas origins. To add another institution, add
its HTTPS Canvas origin to `Authentication:Canvas:AllowedInstanceUrls` (or the
existing `AllowedOrigins` override). Optionally set entries under
`Authentication:Canvas:Schools` with `Name` and `InstanceUrl` to provide a friendly
school name; otherwise the dropdown displays the hostname. Advanced manual entry
still uses the same server allowlist. The screenshot walkthrough presents one
large image at a time, with navigation and a full-size image link.


Verified Canvas school defaults (2026-09-09):

| School | Canvas origin | Official reference |
| --- | --- | --- |
| Simon Fraser University | `https://sfu.instructure.com` | [SFU Canvas support](https://www.sfu.ca/canvas.html) |
| University of British Columbia | `https://canvas.ubc.ca` | [UBC student Canvas guide](https://students.canvas.ubc.ca/) |
| University of Saskatchewan | `https://canvas.usask.ca` | [USask Canvas](https://students.usask.ca/study/canvas.php) |
| University of Washington | `https://canvas.uw.edu` | [UW Canvas access instructions](https://education.uw.edu/sites/default/files/Student_Directions_Accessing_Your_Canvas_Course.pdf) |
| Stanford University | `https://canvas.stanford.edu` | [Stanford Canvas support](https://gocanvas.stanford.edu/contact-us) |
| Harvard University | `https://canvas.harvard.edu` | [Harvard Canvas login](https://atg.fas.harvard.edu/login-canvas) |
| University of Toronto | `https://q.utoronto.ca` | [U of T Quercus student support](https://teaching.utoronto.ca/student-support/) |
| University of California, Los Angeles | `https://bruinlearn.ucla.edu` | [UCLA Canvas security notice](https://ociso.ucla.edu/news/security-incident-instructure-canvas) |
| University of California, Berkeley | `https://bcourses.berkeley.edu` | [UC Berkeley bCourses access](https://berkeley.service-now.com/kb_view.do?sysparm_article=KB0010836) |
| University of Michigan | `https://canvas.it.umich.edu` | [U-M Canvas login](https://canvas.it.umich.edu/) |
| University of Illinois Urbana-Champaign | `https://canvas.illinois.edu` | [Canvas@Illinois access](https://answers.uillinois.edu/illinois/page.php?id=112244) |
| University of Minnesota | `https://canvas.umn.edu` | [UMN Canvas access](https://digitaled.umn.edu/get-help/new-teaching) |
| University of Virginia | `https://canvas.virginia.edu` | [UVACanvas login](https://canvas.virginia.edu/connect-login) |
| University of Colorado Boulder | `https://canvas.colorado.edu` | [Canvas at CU Boulder](https://canvas.colorado.edu/) |
| University of Pennsylvania | `https://canvas.upenn.edu` | [Penn Canvas login guidance](https://infocanvas.upenn.edu/students/access-canvas-log-in-students/) |
| Cornell University | `https://login.canvas.cornell.edu` | [Canvas@Cornell login](https://login.canvas.cornell.edu/) |
| Seoul National University | `https://etl.snu.ac.kr` | [SNU eTL service information](https://www.snu.ac.kr/campuslife/aid/it) |
| Korea University | `https://lms.korea.ac.kr` | [KU LMS manual](https://digital.korea.ac.kr/ic/etc/LMS_manual_top.do) |
| Sungkyunkwan University | `https://icampus.skku.edu` | [SKKU Canvas notice](https://semi.skku.edu/summer/board/notice.do?article.offset=0&articleLimit=10&articleNo=158503&mode=view) |
| The University of Suwon | `https://canvas.suwon.ac.kr` | [Suwon University CANVAS service](https://www.suwon.ac.kr/index.html?menuno=2170) |

Each origin's Canvas profile API returned an authentication-required response without
redirecting to another host during verification. Actual access still depends on the
user's token and the institution's token permissions. Existing deployment overrides
remain authoritative; update `CANVAS_ALLOWED_INSTANCE_URLS` or `AllowedOrigins` when
expanding a deployment with an explicitly restricted school list.
