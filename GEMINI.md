# GEMINI.md

- `docker build --build-arg APP_VERSION=<ver> -t thvysy44/trek-fork:local . && TREK_IMAGE=thvysy44/trek-fork:local docker compose --project-directory "$PWD" -p trek -f .trek-deploy-agent/production/current/docker-compose.yml -f .trek-deploy-agent/production/current/docker-compose.override.yml up -d --no-build --pull never --wait app` — Deploy local build directly to running production container with bind-mounted SQLite and uploads.
- `Place multi-assignment` — DB schema and WebSocket reconciliation support multiple assignments per place; assign controls (+ button in sidebar, mobile add place, place sheet day picker) must not gate on inDay.
- `Vacay holiday classification` — PTO, 公共假期, and 病假 retain separate colors across desktop and mobile; annual leave counter includes PTO and public holidays but excludes 病假.
- `npm run test --workspace=client -- src/...` — Client Vitest paths must be workspace-relative.
- `Places API key IP restriction` — Outbound calls prefer IPv6; whitelist both public IPv4 and `/64` IPv6 prefix in GCP (`trek-production-506619` / `trek-places-server-v2`) when `API_KEY_IP_ADDRESS_BLOCKED` occurs.
