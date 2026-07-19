# CI/CD Phases 3–4: Tailscale Deployment

**Implementation status:** Phase 3 staging validation is complete. The original
validation used pinned SSH over Tailscale, but the maintained deployment path now
uses a restricted local deployment agent and does not permit remote shell access.
Phase 4 uses the same agent for stable production deployments and explicit
rollback after GitHub Environment approval.

Secrets must never be written to source control or workflow logs.

## Architecture

The staging and production jobs run on GitHub-hosted runners. Each runner joins
the tailnet with `tailscale/github-action`, then sends one HMAC-authenticated JSON
request to the private deployment endpoint:

```text
GitHub Environment approval
        |
GitHub-hosted runner + ephemeral Tailscale node
        |
HTTPS over the tailnet (tcp:443)
        |
Tailscale Serve path /__trek-deploy
        |
127.0.0.1:8786 restricted deployment agent
        |
fixed Docker Compose deployment on home-macbook-air
```

The agent is not a shell or general-purpose GitHub runner. It accepts only:

- environment: `staging` or `production`;
- action: `deploy` or `rollback`;
- an environment-appropriate semantic version;
- its matching tag or a full 40-character source SHA;
- image repository `thvysy44/trek-fork` pinned by a SHA-256 digest; and
- a bounded request identifier.

Every request is signed with a timestamp, one-time nonce, and HMAC-SHA256. The
agent rejects expired or replayed requests, fetches Compose definitions only
from `syyangv/TREK`, validates the resolved image digest, runs fixed Docker
commands without a shell, verifies the running container identity, and performs
a local health check before advancing the environment's current-release marker.
A failed deployment restores the prior complete release when one exists.

## Local agent installation

Run from the intended deployment checkout:

```bash
TREK_DEPLOY_PATH=/Users/syang/projects/TREK \
  ./scripts/install_trek_deploy_agent.sh
```

The installer:

- copies the agent to `~/.local/share/trek-deploy-agent`;
- creates a random token in `~/.config/trek-deploy-agent/config.json` with mode
  `0600`;
- installs the user LaunchAgent `com.syang.trek-deploy-agent`;
- binds the API only to `127.0.0.1:8786`; and
- mounts it under the existing tailnet-only HTTPS listener at
  `/__trek-deploy` using Tailscale Serve.

Deployment state and checked source-controlled Compose definitions are stored in
`DEPLOY_PATH/.trek-deploy-agent`. The protected application `.env`, `data`, and
`uploads` remain in `DEPLOY_PATH` and are never returned by the API.

## GitHub configuration

Both `staging` and `production` need these Environment secrets:

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`
- `TREK_DEPLOY_TOKEN`

The deploy token must match the local agent configuration. GitHub cannot reveal
an existing Environment secret, so set it directly from the local config without
printing it.

Both Environments need these variables:

- `TS_TARGETS`: `home-macbook-air.tailcd6e49.ts.net`
- `TS_TAGS`: defaults to `tag:trek-staging-ci`
- `APP_URL`: `https://home-macbook-air.tailcd6e49.ts.net`
- `DEPLOY_AGENT_URL`: `https://home-macbook-air.tailcd6e49.ts.net/__trek-deploy`

The tailnet grant only needs `tcp:443` from `tag:trek-staging-ci` to the host tag.
The earlier `tcp:22` grant and GitHub SSH secrets are no longer required and may
be removed after the agent path passes validation.

## Staging (Phase 3)

`.github/workflows/deploy-staging.yml` deploys a pinned prerelease after the
prerelease workflow succeeds. It can also be dispatched with an explicit
prerelease version. The job resolves the published tag to an immutable digest,
sends the signed request through Tailscale, and verifies `/api/health`.

### Phase 3 evidence

The original operational proof remains valid evidence for the artifact, digest,
Tailscale connectivity, Compose deployment, and health check. A new validation
run is required before removing the old SSH settings.

- Version: `3.5.0-pre.1`
- Source SHA: `b2ce72f1f5a45866213d3590f8ce75984e4c07a1`
- Image digest: `sha256:e07dd5911d0d81021249f1338acaf32033949e12e93cf40bf2188bb355c2e3d7`
- Build run: <https://github.com/syyangv/TREK/actions/runs/29695001033>
- Original successful staging run: <https://github.com/syyangv/TREK/actions/runs/29697412933>

## Production (Phase 4)

`.github/workflows/deploy-production.yml` is manual-only and targets the
`production` GitHub Environment. Required reviewers must approve the job before
it receives Environment secrets or contacts the deployment agent.

Inputs:

- `version`: stable semantic version, such as `3.5.0`;
- `action`: `deploy` or `rollback`.

Both actions use the same immutable path. An explicit rollback deploys the
selected older stable version rather than executing arbitrary rollback commands.

## Validation checklist

- [ ] Install the local agent and verify its localhost health endpoint.
- [ ] Add `TREK_DEPLOY_TOKEN` to `staging` and `production`.
- [ ] Add `DEPLOY_AGENT_URL` to both Environments.
- [ ] Add the Tailscale OAuth secrets to `production`.
- [ ] Confirm the private agent health endpoint is reachable from a tagged
      GitHub-hosted runner.
- [ ] Re-run staging with `3.5.0-pre.1` and verify digest and health.
- [ ] Remove the obsolete SSH secrets and `tcp:22` grant.
- [x] Confirm the `production` Environment requires reviewer approval.
- [ ] Publish and verify stable release `3.5.0`.
- [ ] Approve and run the production deployment for `3.5.0`.
- [ ] Identify and exercise a prior known-good stable rollback version.

If no prior stable production deployment exists, rollback cannot be marked
complete until two known-good stable releases exist and the older version has
been exercised successfully.
