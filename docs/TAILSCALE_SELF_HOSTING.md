# Tailscale self-hosting notes for this fork

This fork is configured for a private TREK instance hosted from the local checkout on `home-macbook-air` and exposed only to the Tailscale tailnet.

## Access

Tailnet URL:

```text
https://home-macbook-air.tailcd6e49.ts.net/
```

Local host URL:

```text
http://localhost:3000
```

Admin credentials are intentionally **not committed**. On the host Mac, read them from:

```bash
cat .trek-admin-credentials
```

## Files that matter

- `docker-compose.yml` — upstream production Compose defaults.
- `docker-compose.override.yml` — fork-local override that builds this checkout and sets the Tailscale URL defaults.
- `.env` — local secrets and deployment values; ignored by git.
- `.trek-admin-credentials` — generated initial admin login; ignored by git.
- `data/` — SQLite database and logs; ignored by git.
- `uploads/` — uploaded documents/photos/assets; ignored by git.

## Start or rebuild

From the repo root:

```bash
docker compose up -d --build
```

This builds the image from the local fork and preserves persisted state in `data/` and `uploads/`.

## Check health

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -k -fsS https://home-macbook-air.tailcd6e49.ts.net/api/health
```

Expected response:

```json
{"status":"ok"}
```

## Logs

```bash
docker logs -f trek
```

## Tailscale Serve

Current serve target:

```bash
tailscale serve status
```

Expose TREK over the tailnet:

```bash
tailscale serve --bg 3000
```

Disable the HTTPS serve endpoint:

```bash
tailscale serve --https=443 off
```

## Admin login and reset

TREK only applies `ADMIN_EMAIL` and `ADMIN_PASSWORD` on first boot when no users exist. In Docker Compose, `.env` values are only passed into the container if the Compose YAML references them under `environment:`.

This fork's `docker-compose.override.yml` explicitly passes:

```yaml
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@trek.local}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
```

If locked out, reset or create the admin account without deleting trip data:

```bash
set -a
. ./.env
set +a
docker exec \
  -e RESET_ADMIN_EMAIL="$ADMIN_EMAIL" \
  -e RESET_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  trek node server/reset-admin.js
```

After reset, TREK marks the account with `must_change_password`, so the next login should prompt for a new password.

## Update from upstream

```bash
git fetch upstream
git checkout main
git merge upstream/main
docker compose up -d --build
```

Then verify health and login before pushing changes to `origin`.

## Stop

```bash
docker compose down
```

This stops the container but keeps `data/` and `uploads/` on disk.
