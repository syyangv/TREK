# TREK CI/CD Design

## Purpose

This document defines a senior-engineer CI/CD design for TREK. The goal is to make every merged change reproducible, tested, releasable, and deployable without coupling upstream releases to any one self-hosted deployment.

## Current State

TREK already has a solid foundation:

- npm workspaces: `shared`, `server`, `client`
- Multi-stage Docker production image
- Docker Compose production template
- Helm chart
- GitHub Actions for:
  - tests
  - lint/prettier
  - Docker stable image publishing
  - Docker prerelease image publishing
  - Docker Scout security scan
  - wiki deploy
  - plugin SDK publishing
  - issue/PR hygiene

Main gaps:

1. Release image publishing is not clearly gated by a single required CI result.
2. Docker smoke testing is missing before publish.
3. Staging and production deployment concerns are not separated from artifact publishing.
4. CI is split across workflows with some duplicated install/build behavior.
5. Local/self-host deployment should be explicitly separate from upstream release automation.

## Target Model

Use this delivery flow:

```text
feature/* -> dev -> main -> versioned release artifacts -> optional deployment
```

Branch meanings:

- `feature/*`: active development
- `dev`: integration branch; prerelease candidate source
- `main`: stable, releasable branch

Artifact meanings:

- `mauriceboe/trek:<version>`: immutable stable release
- `mauriceboe/trek:<major>`: latest stable for major line
- `mauriceboe/trek:latest`: latest stable
- `mauriceboe/trek:<version>-pre.N`: immutable prerelease
- `mauriceboe/trek:latest-pre`: latest prerelease

## Required PR CI

Every PR to `dev` or `main` should run the same required quality gates.

### 1. Change Detection

Add a lightweight `changes` job that identifies touched areas:

- `shared/**`
- `server/**`
- `client/**`
- `Dockerfile`, `docker-compose*.yml`
- `charts/**`
- `plugin-sdk/**`
- `wiki/**`
- GitHub workflow files

This enables skipping expensive jobs for docs/wiki-only changes while still enforcing relevant checks.

### 2. Shared Package Gate

Run when `shared` or consumers changed.

Commands:

```bash
npm ci
npm run build --workspace=shared
npm run typecheck --workspace=shared
npm test --workspace=shared
node shared/scripts/i18n-parity.mjs --strict
```

### 3. Server Gate

Run when `server` or `shared` changed.

Commands:

```bash
npm ci
npm run build --workspace=shared
npm run build --workspace=server
npm run typecheck --workspace=server
npm run lint:check --workspace=server
npm run test:coverage --workspace=server
```

Notes:

- Keep the existing Linux `@swc/core` native binary workaround if still required by CI runners.
- Upload `server/coverage/` as a short-lived artifact.

### 4. Client Gate

Run when `client` or `shared` changed.

Commands:

```bash
npm ci
npm run build --workspace=shared
npm run typecheck --workspace=client
npm run lint:check --workspace=client
npm run lint:pages --workspace=client
npm run test:coverage --workspace=client
```

Upload `client/coverage/` as a short-lived artifact.

### 5. Docker Smoke Gate

Run when runtime, Docker, server, client, or shared code changed.

Minimum smoke test:

```bash
docker build -t trek:ci .
docker run -d --name trek-smoke -p 3000:3000 \
  -e ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
  trek:ci
curl -f http://localhost:3000/api/health
docker logs trek-smoke
docker stop trek-smoke
```

This catches failures that TypeScript cannot catch, including:

- missing runtime assets
- broken server `dist`
- bad Docker layer copy paths
- native module/runtime mismatch
- startup regressions

### 6. Security Gate

Run on PRs and pushes to release branches.

Recommended checks:

- dependency audit or advisory scan
- Docker image vulnerability scan with Docker Scout or Trivy
- CodeQL or equivalent static analysis for JavaScript/TypeScript
- upload SARIF for scanner results when supported

Policy:

- fail on fixed high/critical image CVEs
- fail on critical dependency vulnerabilities
- allow documented, time-boxed exceptions only through an explicit ignore file or security approval

## Branch Protection

Require these checks before merging to `dev` and `main`:

- Shared package gate
- Server gate
- Client gate
- Docker smoke gate when applicable
- Security gate when applicable
- PR target branch enforcement

Recommended GitHub settings:

- require branches to be up to date before merge
- require linear history for `main`
- require signed tags for releases if maintainers support it
- restrict direct pushes to `main`

## Release Pipeline

Stable releases should publish artifacts only after the exact commit has passed required CI.

Trigger:

- push to `main`
- manual `workflow_dispatch`

Release stages:

1. Verify required CI and security scans passed for the exact commit.
2. Determine version bump.
3. Update versions and record the generated release commit SHA:
   - root `package.json`
   - `package-lock.json`
   - workspace package manifests
   - Helm chart version/appVersion
4. Commit version bump with `[skip ci]` if keeping current model.
5. Build multi-arch Docker image from the recorded SHA:
   - `linux/amd64`
   - `linux/arm64`
6. Push immutable digests.
7. Create and push manifest tags:
   - `latest`
   - `<major>`
   - `<version>`
8. Inspect manifest.
9. Publish the matching Helm chart.
10. Generate release notes.
11. Attach or publish SBOM/provenance.
12. Create git tag `vX.Y.Z` and the GitHub Release only after artifacts succeed.

Important design rule:

> Build once, promote by digest. Do not rebuild different bits for staging and production.

## Prerelease Pipeline

Prereleases should be sourced from `dev` or manually dispatched from a selected commit.

Tags:

- `vX.Y.Z-pre.N`
- `latest-pre`
- `<major>-pre`

Use cases:

- test migrations
- test Docker image changes
- validate major/minor features before stable release
- optional staging deployment

Keep prerelease retention cleanup, but preserve enough history for rollback. Current retention of 20 prerelease tags is reasonable.

## Deployment Model

Separate artifact publishing from environment deployment.

### Upstream/Public Deployment

For public TREK users, CI/CD should publish:

- Docker images
- Helm charts
- GitHub releases
- release notes

Users decide when to pull and run.

### Staging Environment

Optional but recommended.

Trigger:

- successful prerelease image publish
- manual workflow dispatch

Actions:

- deploy `latest-pre` or a pinned prerelease tag
- run post-deploy health checks
- run a smoke login/bootstrap check if credentials are available

### Production Environment

Trigger:

- stable release published
- manual approval through GitHub Environments

Actions:

- deploy a digest resolved from the pinned version tag, not `latest`
- verify `/api/health`
- verify application version endpoint or container label
- capture logs on failure
- support rollback to previous pinned tag

## Self-Hosted / Personal Deployment

Your local Tailscale deployment should be separate from upstream CI.

Current local override builds:

```yaml
image: syyangv/trek:tailscale
```

Recommended local deploy flow:

```bash
docker compose build
docker compose up -d
docker compose logs -f app
```

For automated personal deployment, use one of:

1. local script run from the host
2. GitHub Actions environment with Tailscale/SSH
3. Watchtower or similar image watcher

Do not mix personal deployment secrets into upstream release workflows.

## Secrets and Permissions

Use least privilege per workflow.

Recommended secret scopes:

- Docker publishing:
  - `DOCKERHUB_USERNAME`
  - `DOCKERHUB_TOKEN`
- npm plugin SDK publish:
  - `NPM_TOKEN`
- personal deployment:
  - separate GitHub Environment secrets only, not repo-wide secrets

Recommended permissions:

- PR CI: `contents: read`
- coverage artifact upload: `contents: read`, `actions: write` only if needed
- Docker release: `contents: write`, package/publish credentials from secrets
- wiki deploy: `contents: write`
- issue hygiene: issue/PR write only

Avoid broad workflow-level `contents: write` unless the job commits, tags, or deploys docs.

## Observability and Failure Handling

Every deploy job should emit:

- image tag
- image digest
- app version
- target environment
- health check result
- last container logs on failure

Every release should make rollback obvious:

```bash
docker compose pull
docker compose up -d
```

with the previous pinned image tag.

## Rollout Plan

### Phase 1: CI Reliability

- Normalize install/build steps across workflows.
- Ensure CI runs on PR and push to `dev`/`main`.
- Add Docker smoke test.
- Make these checks required in branch protection.

### Phase 2: Release Gating

- Ensure Docker stable release only runs after required CI success.
- Keep multi-arch digest build.
- Add SBOM/provenance generation.
- Publish release notes.

### Phase 3: Staging

- Add prerelease image deployment to staging.
- Add post-deploy health checks.
- Add manual promotion path.

### Phase 4: Production Deployment

- Add GitHub Environment `production` with manual approval.
- Deploy pinned tags.
- Add rollback runbook.

## Proposed Workflow Inventory

Recommended final workflows:

```text
.github/workflows/ci.yml
.github/workflows/docker-pr-smoke.yml        # optional, can live inside ci.yml
.github/workflows/release-stable.yml
.github/workflows/release-prerelease.yml
.github/workflows/security.yml
.github/workflows/wiki.yml
.github/workflows/publish-plugin-sdk.yml
.github/workflows/pr-hygiene.yml             # optional consolidation
```

Existing hygiene workflows can stay separate because they are low-risk and operationally simple.

## Definition of Done

CI/CD redesign is complete when:

- PRs cannot merge without relevant typecheck/lint/test gates.
- Docker image startup is smoke-tested before publish.
- Stable image publishing is gated on successful CI.
- Release artifacts are immutable and versioned.
- Staging and production deployment are environment-scoped.
- Production deploys use pinned versions and have a documented rollback path.
- Secrets are scoped to the smallest workflow/environment possible.

## Detailed Implementation Checklist

### 0. Preparation

- [ ] Confirm canonical repository and release owner.
- [ ] Confirm default branch policy: `feature/* -> dev -> main`.
- [ ] Inventory required GitHub secrets:
  - [ ] `DOCKERHUB_USERNAME`
  - [ ] `DOCKERHUB_TOKEN`
  - [ ] `NPM_TOKEN` for plugin SDK publishing
  - [ ] staging deployment secrets, if any
  - [ ] production deployment secrets, if any
- [ ] Confirm GitHub Environments needed:
  - [ ] `staging`
  - [ ] `production`
- [ ] Confirm whether personal/self-host deployment belongs in this repo or in a private fork.
- [ ] Confirm supported Node version for CI and Docker runtime.
- [ ] Confirm required package manager command: `npm ci` from root lockfile.

### 1. Branch Protection

- [ ] Protect `main`.
- [ ] Protect `dev`.
- [ ] Require PRs before merge to `main`.
- [ ] Require PRs before merge to `dev` unless maintainers intentionally allow direct integration pushes.
- [ ] Require status checks on `main`:
  - [ ] shared package gate
  - [ ] server gate
  - [ ] client gate
  - [ ] Docker smoke gate when applicable
  - [ ] security gate when applicable
- [ ] Require status checks on `dev`:
  - [ ] shared package gate
  - [ ] server gate
  - [ ] client gate
  - [ ] Docker smoke gate when applicable
- [ ] Require branches to be up to date before merge, or explicitly choose merge queue instead.
- [ ] Require linear history for `main`, if compatible with maintainer workflow.
- [ ] Restrict direct pushes to `main` to maintainers or release automation only.
- [ ] Keep PR target branch enforcement workflow enabled.

### 2. CI Workflow Consolidation

- [ ] Create or update `.github/workflows/ci.yml`.
- [ ] Trigger CI on PRs to `dev` and `main`.
- [ ] Trigger CI on pushes to `dev` and `main`.
- [ ] Add workflow concurrency:
  - [ ] group by branch/PR
  - [ ] cancel in-progress for PR updates
- [ ] Add a `changes` job using path filters.
- [ ] Define outputs for:
  - [ ] `shared_changed`
  - [ ] `server_changed`
  - [ ] `client_changed`
  - [ ] `docker_changed`
  - [ ] `charts_changed`
  - [ ] `plugin_sdk_changed`
  - [ ] `docs_only`
- [ ] Skip expensive jobs for docs/wiki-only changes where safe.
- [ ] Ensure skipped jobs still report success or are not configured as required checks.

### 3. Shared Package Gate

- [ ] Install dependencies from the root lockfile.
- [ ] Build shared package:
  - [ ] `npm run build --workspace=shared`
- [ ] Typecheck shared package:
  - [ ] `npm run typecheck --workspace=shared`
- [ ] Run shared tests:
  - [ ] `npm test --workspace=shared`
- [ ] Run i18n parity:
  - [ ] `node shared/scripts/i18n-parity.mjs --strict`
- [ ] Upload relevant logs/artifacts on failure if useful.

### 4. Server Gate

- [ ] Install dependencies with `npm ci`.
- [ ] Build shared before server.
- [ ] Build server:
  - [ ] `npm run build --workspace=server`
- [ ] Typecheck server:
  - [ ] `npm run typecheck --workspace=server`
- [ ] Lint server:
  - [ ] `npm run lint:check --workspace=server`
- [ ] Run server tests with coverage:
  - [ ] `npm run test:coverage --workspace=server`
- [ ] Keep or remove SWC Linux native-binary workaround after validating current lockfile behavior.
- [ ] Upload `server/coverage/` artifact.
- [ ] Confirm server tests include database migration coverage.
- [ ] Confirm server tests include plugin host/MCP coverage.

### 5. Client Gate

- [ ] Install dependencies with `npm ci`.
- [ ] Build shared before client checks.
- [ ] Typecheck client:
  - [ ] `npm run typecheck --workspace=client`
- [ ] Lint client:
  - [ ] `npm run lint:check --workspace=client`
- [ ] Run page pattern check:
  - [ ] `npm run lint:pages --workspace=client`
- [ ] Run client tests with coverage:
  - [ ] `npm run test:coverage --workspace=client`
- [ ] Upload `client/coverage/` artifact.
- [ ] Fix or document any CI environment assumptions around `localStorage`/jsdom.

### 6. Docker Smoke Gate

- [ ] Add Docker build smoke job for PRs touching runtime-sensitive files.
- [ ] Build image locally in CI:
  - [ ] `docker build -t trek:ci .`
- [ ] Start container with test env:
  - [ ] fixed `ENCRYPTION_KEY`
  - [ ] temporary data/upload directories
  - [ ] exposed port
- [ ] Wait for server startup.
- [ ] Check health endpoint:
  - [ ] `curl -f http://localhost:3000/api/health`
- [ ] Print container logs on failure.
- [ ] Stop and remove smoke container in an always-run cleanup step.
- [ ] Optionally verify app version/env endpoint if available.
- [ ] Optionally verify static client asset serving.

### 7. Security Checks

- [ ] Keep Docker Scout or replace with Trivy if preferred.
- [ ] Scan Docker image before publish.
- [ ] Fail on fixed high/critical image CVEs.
- [ ] Add dependency vulnerability scan.
- [ ] Add CodeQL or equivalent static analysis for TypeScript/JavaScript.
- [ ] Upload SARIF results where supported.
- [ ] Define exception process for accepted vulnerabilities.
- [ ] Store exceptions in version-controlled config, not in ad hoc workflow logic.
- [ ] Review workflow permissions for least privilege.

### 8. Stable Release Workflow

- [ ] Rename or replace current stable Docker workflow with `release-stable.yml`.
- [ ] Trigger on push to `main` and manual dispatch.
- [ ] Ensure release job only runs after required CI success.
- [ ] Decide gating mechanism:
  - [ ] `workflow_run` after CI success, or
  - [ ] release workflow includes CI as `needs`, or
  - [ ] release workflow verifies required checks via GitHub API
- [ ] Keep version bump logic or replace with semantic-release/changesets.
- [ ] Update package versions.
- [ ] Update Helm chart version/appVersion.
- [ ] Commit version bump with bot identity.
- [ ] Create annotated or lightweight tag `vX.Y.Z`.
- [ ] Build Docker image for `linux/amd64`.
- [ ] Build Docker image for `linux/arm64`.
- [ ] Push platform images by digest.
- [ ] Create multi-arch manifest.
- [ ] Tag manifest:
  - [ ] `latest`
  - [ ] `<major>`
  - [ ] `<version>`
- [ ] Inspect manifest after push.
- [ ] Publish Helm chart.
- [ ] Generate release notes.
- [ ] Publish GitHub Release.
- [ ] Attach or link SBOM/provenance artifacts.

### 9. Prerelease Workflow

- [ ] Keep or rename prerelease workflow to `release-prerelease.yml`.
- [ ] Source prerelease from `dev` or explicit workflow dispatch ref.
- [ ] Version prerelease as `vX.Y.Z-pre.N`.
- [ ] Build multi-arch images.
- [ ] Tag prerelease images:
  - [ ] `latest-pre`
  - [ ] `<major>-pre`
  - [ ] `<version>-pre.N`
- [ ] Inspect prerelease manifest.
- [ ] Push git prerelease tag.
- [ ] Keep prerelease cleanup policy.
- [ ] Confirm cleanup never deletes the currently deployed staging tag.

### 10. Staging Deployment

- [ ] Create GitHub Environment `staging`.
- [ ] Add staging deployment secrets if needed.
- [ ] Deploy pinned prerelease tag or digest.
- [ ] Avoid deploying mutable `latest-pre` unless the staging host is explicitly designed for it.
- [ ] Run post-deploy health check.
- [ ] Capture app version after deploy.
- [ ] Capture logs on failure.
- [ ] Add manual redeploy workflow for a selected prerelease tag.
- [ ] Document staging URL and access expectations.

### 11. Production Deployment

- [ ] Create GitHub Environment `production`.
- [ ] Require manual approval for production deploys.
- [ ] Deploy pinned stable version tag or digest.
- [ ] Do not deploy `latest` directly to production unless using a deliberate auto-update policy.
- [ ] Run post-deploy health check.
- [ ] Verify app version after deploy.
- [ ] Capture logs on failure.
- [ ] Add rollback input for previous version tag.
- [ ] Document production deploy command/path.
- [ ] Document production rollback command/path.

### 12. Personal / Tailscale Deployment

- [ ] Keep personal deployment separate from upstream release workflows.
- [ ] Decide whether personal deployment lives in:
  - [ ] private fork workflow
  - [ ] local shell script
  - [ ] private GitHub Environment in this repo
- [ ] Ensure personal deployment secrets are environment-scoped.
- [ ] Use pinned image tags when stability matters.
- [ ] If using local build, run:
  - [ ] `docker compose build`
  - [ ] `docker compose up -d`
  - [ ] `docker compose logs -f app`
- [ ] Add Obsidian-specific mount/env configuration only to personal deployment config, not public defaults, unless upstream feature is documented.

### 13. Documentation

- [ ] Update `README.md` release/deploy notes if behavior changes.
- [ ] Update `wiki/Environment-Variables.md` for any new CI/deploy-relevant env vars.
- [ ] Add a release runbook.
- [ ] Add a rollback runbook.
- [ ] Add staging/production deployment ownership notes.
- [ ] Document expected checks in CONTRIBUTING.
- [ ] Document branch target expectations: external PRs to `dev`.

### 14. Validation Before Enforcing

- [ ] Run new CI workflow on a test branch.
- [ ] Open a draft PR to validate PR behavior.
- [ ] Confirm docs-only changes skip expensive jobs correctly.
- [ ] Confirm server-only changes run shared/server and skip client where safe.
- [ ] Confirm client-only changes run shared/client and skip server where safe.
- [ ] Confirm Docker-sensitive changes run Docker smoke.
- [ ] Confirm failed smoke test blocks merge.
- [ ] Confirm stable release workflow does not publish if CI failed.
- [ ] Confirm prerelease workflow publishes expected tags.
- [ ] Confirm Helm chart publishing still works.

### 15. Cutover

- [ ] Mark new checks as required in branch protection.
- [ ] Disable superseded duplicate workflows.
- [ ] Keep old workflows available for one release cycle if rollback is needed.
- [ ] Announce contributor-facing changes.
- [ ] Monitor first PRs after cutover.
- [ ] Monitor first stable release after cutover.
- [ ] Remove old workflows after successful stable release.
