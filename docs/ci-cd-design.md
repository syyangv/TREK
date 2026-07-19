# TREK CI/CD Design

## Purpose

This document defines a senior-engineer CI/CD design for TREK. The goal is to make every merged change reproducible, tested, releasable, and deployable without coupling upstream releases to any one self-hosted deployment.

## Implementation Status

**Last updated:** 2026-07-19
**Release fork:** `syyangv/TREK`

| Phase | Implementation | Operational validation | Current evidence / blocker |
| --- | --- | --- | --- |
| Phase 1 — CI reliability | Complete on `main` | Complete for the aggregate CI model | Hardening merged in `5210ff4d`; `Phase 1 Checks`, Docker smoke, and Helm chart validation passed. Requiring separate Security/target-branch checks remains an explicit governance follow-up. |
| Phase 2 — stable release gating | Complete | Complete | Stable `3.5.0` published as a multi-architecture image with SBOM, manifest metadata, Helm chart, and GitHub Release in run `29700948816`. |
| Phase 3 — prerelease/staging | Complete on `main` | Complete | Prerelease `3.5.0-pre.1` deployed by immutable digest through the restricted Tailscale deployment agent; staging run `29697412933` passed image identity and health validation. |
| Phase 4 — production/rollback | Restricted Tailscale agent implemented | Deployment complete; rollback pending | Stable `3.5.0` deployed by digest in approved run `29701278056`; rollback awaits a second known-good stable production release. |

Current execution order:

- [x] Merge immutable-artifact and deployment hardening.
- [x] Prove the Security Scan can succeed with configured Docker Hub credentials.
- [x] Fix release gating so a successful rerun for the exact SHA supersedes an earlier failed attempt.
- [x] Complete CI for `825bf6bb`.
- [x] Complete Security Scan
  [`29467263383`](https://github.com/syyangv/TREK/actions/runs/29467263383)
  for `825bf6bb`.
- [x] Publish and verify stable `3.5.0`, including its multi-architecture image, Helm chart, SBOM, manifest metadata, and GitHub Release.
- [x] Reconcile the prerelease lane with the hardened staging workflow.
- [x] Complete CI and Security Scan for the prerelease source.
- [x] Publish and verify prerelease `3.5.0-pre.1` and record its source SHA and digest.
- [x] Configure and verify staging Environment settings.
- [x] Deploy the recorded prerelease digest to staging and verify health in run `29697412933`.
- [x] Configure and approve production Environment settings.
- [ ] Record and validate a prior known-good stable rollback target.
- [x] Deploy stable `3.5.0` to production by digest and verify health.
- [ ] Roll back to the prior known-good version and verify health/digest.

Do not mark a phase operationally complete from workflow source alone. Completion
requires a successful GitHub Actions run and the artifact/deployment evidence
listed above.

## Pre-implementation Baseline (Historical)

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

Gaps recorded when the design was created (subsequently addressed unless the
status table above says otherwise):

1. Release image publishing is not clearly gated by a single required CI result.
2. Docker smoke testing is missing before publish.
3. Staging and production deployment concerns are not separated from artifact publishing.
4. CI is split across workflows with some duplicated install/build behavior.
5. Local/self-host deployment should be explicitly separate from upstream release automation.

## Implemented Target Model

Use this delivery flow:

```text
feature/* -> dev -> main -> versioned release artifacts -> optional deployment
```

Branch meanings:

- `feature/*`: active development
- `dev`: integration branch; prerelease candidate source
- `main`: stable, releasable branch

Artifact meanings:

- `thvysy44/trek-fork:<version>`: immutable stable release produced by the release fork
- `thvysy44/trek-fork:<major>`: latest stable for a major line in the release fork
- `thvysy44/trek-fork:latest`: latest stable in the release fork
- `thvysy44/trek-fork:<version>-pre.N`: immutable prerelease produced from `dev`
- `thvysy44/trek-fork:latest-pre`: latest prerelease in the release fork

`mauriceboe/trek` remains the upstream/public image namespace and is not an
output of the fork workflows. Operators validating `syyangv/TREK` must inspect
and deploy `thvysy44/trek-fork` artifacts.

## Implemented Required PR CI

Every PR to `dev` or `main` should run the same required quality gates.

### 1. Change Detection

The implemented lightweight `changes` job identifies touched areas:

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

The live `main` and `dev` protections require the aggregate `Phase 1 Checks`
context. That aggregate covers applicable shared, server, client, Docker smoke,
and Helm chart gates.

The following checks are separate today and are **not** live required contexts:

- `Security Scan`: required by stable/prerelease publication for the exact SHA,
  but not by PR branch protection because credentialed scanning cannot run for
  untrusted fork code.
- `check-target`: enforces contributor routing through workflow policy, labels,
  and comments, but is not a protected-branch required context.

Governance follow-up: either keep this aggregate model and revise policy to
match it, or add credential-free PR security/target checks before making those
contexts required. Do not describe them as required until branch protection
actually includes them.

Design-time candidate checks were:

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
4. Commit version metadata on temporary branch `release-build/vX.Y.Z`; never
   push the generated commit directly to protected `main`. On retry, reuse that
   commit only when its parent SHA and complete tree match a freshly generated
   release tree; otherwise stop for manual stale-branch resolution.
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
12. Upload retained workflow artifacts before creating the release/tag.
13. Create or resume a draft GitHub Release, verify its target SHA, and publish
    it as the transaction boundary that creates the immutable `vX.Y.Z` tag.
14. Verify the published tag resolves to the generated release commit.
15. Remove the temporary release-build branch on a best-effort basis; cleanup
    failure must not invalidate an otherwise verified release.
16. If publication succeeded but runner status reporting was ambiguous, detect
    the matching published tag and temporary branch on the next run. Treat it
    as the current transaction only when the release commit's parent equals the
    exact validated `main` SHA; otherwise clean it as an older stale branch and
    continue with a new release.

Important design rule:

> Build once within each release lane and deploy that lane's artifact by digest.

The current prerelease/staging and stable/production lanes are separate builds.
Do not claim byte-for-byte staging-to-production promotion unless a future
workflow promotes the exact staged digest into the stable namespace.

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

- deploy a pinned prerelease tag resolved to its digest, not `latest-pre`
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
image: thvysy44/trek-fork:tailscale
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
- credential-safe Kubernetes workload/event diagnostics on failure

Application logs are opt-in diagnostics because first-start output can contain
generated credentials; never print them to Actions logs without an explicit
redaction and access policy.

Every release should make rollback obvious:

```bash
docker compose pull
docker compose up -d
```

with the previous pinned image tag.

## Rollout Record and Remaining Validation

### Phase 1: CI Reliability

- [x] Normalize install/build steps across workflows.
- [x] Ensure CI runs on PR and push to `dev`/`main`.
- [x] Add Docker smoke and Helm chart gates.
- [x] Require the aggregate `Phase 1 Checks` context in branch protection.
- [ ] Decide whether separate Security and target-branch contexts should become
  required, then align branch protection and policy language.

### Phase 2: Release Gating

- [x] Ensure Docker stable release only runs after required CI/security success.
- [x] Keep multi-arch digest build.
- [x] Add SBOM/provenance generation.
- [x] Publish release notes.
- [ ] Complete a post-`825bf6bb` stable release and verify every artifact.

### Phase 3: Staging

- [x] Add prerelease image deployment to staging.
- [x] Add post-deploy health checks.
- [x] Synchronize the hardened prerelease and staging workflow path.
- [x] Verify the prerelease source passes required checks.
- [x] Publish `3.5.0-pre.1` and validate its immutable digest in staging.

Staging validates the prerelease lane; it does not deploy the stable Phase 2
artifact. The current workflows do not implement byte-for-byte promotion from
staging to production. Stable artifacts have their own release proof before
production deployment.

### Phase 4: Production Deployment

- [x] Add GitHub Environment `production` as the manual approval boundary.
- [x] Implement pinned stable deployment through a restricted Tailscale deployment agent and Docker Compose.
- [x] Verify required reviewer protection.
- [x] Configure production-visible Tailscale and deployment-agent settings.
- [x] Publish stable `3.5.0` and validate production deployment.
- [ ] Preflight and execute the rollback runbook.

## Implemented Workflow Inventory

Implemented delivery workflows:

```text
.github/workflows/ci.yml
.github/workflows/docker.yml                 # stable release
.github/workflows/docker-dev.yml             # prerelease
.github/workflows/deploy-staging.yml
.github/workflows/deploy-production.yml
.github/workflows/security.yml
.github/workflows/wiki.yml
.github/workflows/publish-plugin-sdk.yml
```

Existing hygiene workflows can stay separate because they are low-risk and operationally simple.

## Definition of Done

CI/CD redesign is complete when:

- PRs cannot merge without relevant typecheck/lint/test gates.
- Docker image startup is smoke-tested before publish.
- Stable image publishing is gated on successful CI and Security Scan for the
  exact source SHA.
- Release artifacts are immutable and versioned.
- Staging and production deployment are environment-scoped.
- Production deploys use pinned versions resolved to digests and have a
  preflighted rollback target/runbook.
- Secrets are scoped to the smallest workflow/environment possible.

## Original Detailed Implementation Checklist (Historical)

The checklist below is preserved as the design-time work breakdown. Its boxes
are not authoritative implementation status. Use the status table and rollout
record above for current state; use the validation checklist in the phase
documents for operational completion.

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

- [x] Create GitHub Environment `production`.
- [x] Require manual approval for production deploys.
- [x] Deploy pinned stable version tag resolved to an immutable digest.
- [x] Do not deploy `latest` directly to production unless using a deliberate auto-update policy.
- [x] Run post-deploy health check.
- [x] Verify app version after deploy.
- [ ] Capture logs on failure.
- [x] Add rollback input for a selected older stable version.
- [x] Document production deploy command/path.
- [x] Document production rollback command/path.

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
