# CI/CD Phases 3–4: Tailscale Deployment

**Implementation status:** Phase 3 staging validation is complete. The staging
workflow deployed prerelease `3.5.0-pre.1` to `home-macbook-air` by immutable
Docker digest through Tailscale and SSH, and `/api/health` passed. Phase 4 uses
the same transport for stable production deployments, but production deployment
and rollback still require operational validation.

Secrets must never be written to source control or workflow logs. Repository-level
Actions secrets can be reused by both Environments; Environment-scoped secrets
may be used instead when stronger staging/production isolation is required.

## Shared Tailscale and SSH configuration

The deployment workflows require these GitHub Actions secrets:

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`
- `DEPLOY_SSH_PRIVATE_KEY`
- `DEPLOY_SSH_KNOWN_HOSTS`

They also require these repository or Environment variables:

- `TS_TARGETS`: Tailscale target accepted by `tailscale/github-action`
- `TS_TAGS`: defaults to `tag:trek-staging-ci`
- `DEPLOY_HOST`: SSH host on the tailnet
- `DEPLOY_USER`: non-root deployment account
- `DEPLOY_PATH`: existing remote Compose project directory
- `COMPOSE_PROJECT_NAME`: defaults to `trek`
- `APP_URL`: health-check base URL, including scheme

The OAuth credential is limited to **Auth Keys: Write** and creates an ephemeral
runner carrying `tag:trek-staging-ci`. The tailnet grant permits that tag to
reach the deployment host tag on `tcp:22` and `tcp:443`.

The remote directory must already contain a protected `.env` file and the
persistent `data` and `uploads` locations. The workflow transfers only the
versioned Compose definitions. It never transfers or prints the remote `.env`.

## Staging (Phase 3)

`.github/workflows/deploy-staging.yml` deploys a pinned prerelease after the
prerelease workflow succeeds. It can also be dispatched with an explicit
prerelease version.

The workflow:

1. connects a GitHub-hosted runner to the tailnet;
2. verifies the pinned SSH identity and known host;
3. resolves the image tag to an immutable registry digest;
4. transfers the matching Compose files from the release source;
5. pulls and starts that exact digest with an isolated, credential-free Docker
   configuration that cannot read the macOS login Keychain;
6. verifies the running container image and `/api/health`; and
7. restores the previously recorded immutable image and Compose definition if
   a deployment fails after a valid rollback target has been captured.

### Phase 3 evidence

- Version: `3.5.0-pre.1`
- Source SHA: `b2ce72f1f5a45866213d3590f8ce75984e4c07a1`
- Image digest: `sha256:e07dd5911d0d81021249f1338acaf32033949e12e93cf40bf2188bb355c2e3d7`
- Build run: <https://github.com/syyangv/TREK/actions/runs/29695001033>
- Successful staging run: <https://github.com/syyangv/TREK/actions/runs/29697412933>
- Final transport/credential fix: <https://github.com/syyangv/TREK/pull/19>

## Production (Phase 4)

`.github/workflows/deploy-production.yml` is manual-only and targets the
`production` GitHub Environment. Configure required reviewers on that
Environment so approval is required before the job can access deployment
credentials or modify the production service.

Inputs:

- `version`: stable semantic version to deploy, such as `3.5.0`
- `action`: `deploy` or `rollback`

Both actions use the same immutable path: checkout `v<version>`, resolve the
stable image tag to a digest, transfer that tag's Compose definitions, deploy
the digest, verify the running container identity, and check `/api/health`.

Production keeps its release metadata under `.trek-production-ci` in the remote
project directory, separate from staging's `.trek-ci` metadata. A failed
production operation automatically restores the prior complete production
image/Compose pair when one exists. An explicit rollback deploys the selected
older stable version through the same reviewed workflow.

## Phase 4 validation checklist

- [x] Confirm the `production` GitHub Environment requires reviewer approval.
- [ ] Confirm the shared repository secrets and required variables are visible
      to jobs targeting `production`.
- [ ] Confirm `APP_URL`, `DEPLOY_PATH`, and `COMPOSE_PROJECT_NAME` identify the
      intended production service.
- [ ] Publish and verify stable release `3.5.0`, including its source tag and
      immutable image digest.
- [ ] Identify the prior known-good stable rollback version and verify that its
      git tag and Docker manifest still exist.
- [ ] Record the currently deployed container image and health before deployment.
- [ ] Approve and run the production `deploy` operation for `3.5.0`.
- [ ] Verify the recorded digest, running container image, and `/api/health`.
- [ ] Approve and run `rollback` with the prior stable version.
- [ ] Verify the rollback digest, running container image, and `/api/health`.

If no prior stable production deployment exists, the first stable deployment
can be validated, but rollback cannot be marked complete until two known-good
stable releases exist and the older version has been exercised successfully.

As of 2026-07-19, the required-reviewer rule is configured on `production`, but
that Environment has no deployment secrets or variables. The Tailscale/SSH
settings currently exist only under `staging`; Environment-scoped settings are
not inherited by `production`. Copy them manually or promote them to repository
scope before dispatching the production workflow.
