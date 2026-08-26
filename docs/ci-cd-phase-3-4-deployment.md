# CI/CD Phases 3–4: Tailscale Deployment

**Implementation status:** Phase 3 staging validation is complete. The original
validation used pinned SSH over Tailscale, but the maintained deployment path now
uses a restricted local deployment agent and does not permit remote shell access.
Phase 4 uses the same agent for stable production deployments and explicit
rollback after GitHub Environment approval. Stable `3.5.0` is deployed and
healthy; rollback validation remains pending a second known-good stable
production release.

**Commit-driven migration status:** The outbound promotion poller and promotion
record tooling are now implemented, but are not production-enabled by this
repository change. The existing GitHub deployment workflow remains the
break-glass path until the protection, shadow, staging, and rollback gates below
are completed on the deployment host.

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

## Recommended commit-driven production path

The target path moves only the final deployment execution off GitHub Actions.
GitHub Actions remains responsible for CI, security scanning, multi-architecture
image publication, SBOMs, and GitHub Releases. A production-host LaunchAgent
polls a protected `deploy/production` branch and invokes the local agent only
after verifying a signed promotion commit:

```text
normal application commit/push
        |
        v
main -> CI + Security Scan -> stable immutable release
                                      |
                         signed promotion.json commit
                         pushed to deploy/production
                                      |
                                      v
                    production LaunchAgent (outbound poll)
                    -> verify signed commit and release tag
                    -> verify Compose hashes and fast-forward
                    -> deploy locally by immutable digest
                    -> verify container identity and /api/health
```

The promotion branch contains only `promotion.json`. It is not a source
checkout and must be protected separately from `main`. The record binds the
environment, action, release version/tag, gated `main` SHA, generated release
SHA, immutable Docker image digest, both Compose SHA-256 hashes, and promotion
timestamp. It never contains credentials. Create it with:

```bash
python3 scripts/trek_promote.py create \
  --environment production \
  --action deploy \
  --version 3.5.15 \
  --source-sha <gated-main-sha> \
  --release-sha <generated-release-sha> \
  --image thvysy44/trek-fork@sha256:<64-lowercase-hex-digits> \
  --output promotion.json
git add promotion.json
git commit -S -m "promote TREK 3.5.15 to production"
git push origin HEAD:deploy/production
```

The command does not commit or push for the caller. The release approver must
review the generated record and sign the commit with the SSH signing key whose
public key is installed in the production poller's allowed-signers file.
Never force-push or move an existing promotion commit to change its meaning;
rollback is a new signed commit targeting the older immutable release.

### Poller installation and migration gates

Install the poller only after the existing local deployment agent is healthy:

```bash
./scripts/install_trek_deploy_poller.sh
```

The installer creates a separate `com.syang.trek-deploy-poller` LaunchAgent and
starts it with `dry_run: true`. It uses a bare Git repository under the agent's
state directory, never checks out promotion contents, verifies SSH-signed
commits with `git verify-commit`, and keeps a locked, atomically-written state
file. It performs no inbound network serving and does not use the HMAC endpoint.

Before changing `dry_run` to `false`:

1. Protect `deploy/production`: no force pushes/deletions, fast-forward-only,
   designated release reviewers, and signed commits required by policy.
2. Restore and verify the documented `main`, `staging`, and `production`
   protection rules; do not assume the GitHub UI state matches this document.
3. Create an owner-readable allowed-signers file on the host and verify a
   signed sample promotion in poller dry-run mode.
4. Run the poller in shadow mode across at least two stable releases and test
   missing checks, moved tags, wrong digests, wrong Compose hashes, rewritten
   promotion history, and network outages.
5. Bootstrap the current already-deployed promotion explicitly in
   `poller.json`; the first live poll must not deploy an unreviewed historical
   record.
6. Validate staging, persistent SQLite/uploads mounts, app health, PWA update
   prompt/cache advancement, and a two-release rollback drill.
7. Enable production polling with a human-signed promotion commit. Retain
   `deploy-production.yml` as a restricted break-glass path for one soak cycle,
   then retire its tailnet/HMAC credentials only after successful verification.

The implementation is split across `scripts/trek_promotion.py`,
`scripts/trek_promote.py`, `scripts/trek_deploy_poller.py`, and
`scripts/install_trek_deploy_poller.sh`. The existing
`scripts/trek_deploy_agent.py` remains the single fixed Docker/health/recovery
implementation used by both the break-glass HTTP path and the local poller.

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

The original operational proof remains valid evidence for the artifact and
digest. The final no-SSH run independently validated the restricted agent,
Tailscale connectivity, Compose deployment, container identity, and health.

- Version: `3.5.0-pre.1`
- Source SHA: `b2ce72f1f5a45866213d3590f8ce75984e4c07a1`
- Image digest: `sha256:e07dd5911d0d81021249f1338acaf32033949e12e93cf40bf2188bb355c2e3d7`
- Build run: <https://github.com/syyangv/TREK/actions/runs/29695001033>
- Original SSH-based staging run: <https://github.com/syyangv/TREK/actions/runs/29697412933>
- Final no-SSH staging run: <https://github.com/syyangv/TREK/actions/runs/29699390702> (43 seconds)
- Restricted-agent implementation: <https://github.com/syyangv/TREK/pull/21>
- Deterministic IPv4 fetch hotfix: <https://github.com/syyangv/TREK/pull/22>

## Production (Phase 4)

`.github/workflows/deploy-production.yml` is manual-only and targets the
`production` GitHub Environment. Required reviewers must approve the job before
it receives Environment secrets or contacts the deployment agent.

Inputs:

- `version`: stable semantic version, such as `3.5.0`;
- `action`: `deploy` or `rollback`.

Both actions use the same immutable path. An explicit rollback deploys the
selected older stable version rather than executing arbitrary rollback commands.

### Phase 4 production evidence

- Version: `3.5.0`
- Release source/tag commit: `85c9af1dc6dba5b6c48bce00afca0b690b80af73`
- Image digest: `sha256:62635700d78f7cad4b1f47eed92ddb3f5a14a82d39833fd4249fea818957db77`
- Stable release run: <https://github.com/syyangv/TREK/actions/runs/29700948816>
- GitHub Release: <https://github.com/syyangv/TREK/releases/tag/v3.5.0>
- Production deployment run: <https://github.com/syyangv/TREK/actions/runs/29701278056>
- Recorded agent release: `releases/run-29701278056-1`
- Running container digest and both Docker/application health checks passed.

## Validation checklist

- [x] Install the local agent and verify its localhost health endpoint.
- [x] Add `TREK_DEPLOY_TOKEN` to `staging` and `production`.
- [x] Add `DEPLOY_AGENT_URL` to both Environments.
- [x] Add the Tailscale OAuth secrets to `production`.
- [x] Confirm the private agent health endpoint is reachable from a tagged
      GitHub-hosted runner.
- [x] Re-run staging with `3.5.0-pre.1` and verify digest and health.
- [ ] Remove the obsolete SSH secrets and `tcp:22` grant.
- [x] Confirm the `production` Environment requires reviewer approval.
- [x] Publish and verify stable release `3.5.0`.
- [x] Approve and run the production deployment for `3.5.0`.
- [ ] Identify and exercise a prior known-good stable rollback version.

If no prior stable production deployment exists, rollback cannot be marked
complete until two known-good stable releases exist and the older version has
been exercised successfully.
