## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Use a multi-context layout for `client`, `server`, and `shared`. See `docs/agents/domain.md`.

### Upstream synchronization

Before syncing or updating from upstream, follow
`docs/UPSTREAM_SYNC_WORKFLOW.md` and review `docs/FORK_CUSTOMIZATIONS.md`.
The checklist is authoritative for fork-only designs and invariants, including
assignment time slots, reservation-linked assignment persistence, mobile
planned-slot-first/reservation-time-fallback display, and release safeguards.
After conflicts or upstream rewrites, reapply those documented deltas and run
the focused regression tests named by the checklist before declaring the sync
complete.

### Validation

Client Vitest paths must be workspace-relative: `npm run test --workspace=client -- src/...`.

After changing shared schemas or translations, run `npm run build --workspace=shared` before client tests because the client consumes `shared/dist`.

Server integration tests require a local listening socket; rerun outside the sandbox when `listen EPERM` occurs.

### Production release

Merge to `main`, wait for CI, Security Scan, and the stable release, then
create, review, sign, and push the verified promotion record to the protected
`deploy/production` branch. The production-host poller performs the deployment
and health verification. Keep `deploy-production.yml` only as the restricted
break-glass path until the documented soak and rollback gates are complete.

Production deployment requires environment approval and must finish with `/api/health` returning `{"status":"ok"}`.

### Local rebuild (without CI)

The running `trek` container is managed by the deploy agent (`scripts/trek_deploy_agent.py`) and runs a CI-built image from Docker Hub (`thvysy44/trek-fork`, pinned by sha256 digest), not the repo-root `docker-compose.yml`. To ship a local change quickly:

```bash
docker build --build-arg APP_VERSION=<ver> -t thvysy44/trek-fork:local .
TREK_IMAGE=thvysy44/trek-fork:local docker compose \
  --project-directory "$PWD" -p trek \
  -f .trek-deploy-agent/production/current/docker-compose.yml \
  -f .trek-deploy-agent/production/current/docker-compose.override.yml \
  up -d --no-build --pull never --wait app
```

`--project-directory "$PWD"` makes `./data`, `./uploads`, and `.env` resolve from the repo root (where they actually live). This is a temporary override — the deploy agent's release metadata still points at the CI digest, so the next CI deploy replaces it. Data lives in `./data` (SQLite) and `./uploads`, bind-mounted into the container; DB migrations run automatically on startup.

### Push workflow

When the user requests a push, include existing local changes unless they explicitly exclude them.
