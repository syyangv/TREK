# CI/CD Phases 3–4: Environment Deployment

**Implementation status:** Workflows merged to `main`, but the live `dev` branch
does not yet contain the hardened prerelease/security/metadata/staging workflow
set. Operational validation is blocked pending synchronization of `dev`,
prerelease publication, and Environment configuration for staging. The stable
Phase 2 release prerequisite is satisfied by `v3.3.1`; production still requires
successful staging validation and production Environment configuration.

As of 2026-07-15, GitHub reports no configured secret or variable names for the
`staging` or `production` Environments. Do not dispatch deployment validation
until the names below are visible in the intended Environment. Secret values
must never be written to source control or logs.

## Staging (Phase 3)

`.github/workflows/deploy-staging.yml` deploys a pinned prerelease image to the
`staging` GitHub Environment after the prerelease workflow succeeds. It can also
be run manually with an explicit prerelease version.

Required `staging` Environment configuration:

- Secret `KUBE_CONFIG_DATA`: base64-encoded kubeconfig for the staging cluster
- Variable `KUBE_NAMESPACE` (default: `trek-staging`)
- Variable `HELM_RELEASE_NAME` (default: `trek`)
- Variable `APP_URL`: externally reachable staging URL, including scheme

The triggering prerelease workflow publishes a metadata artifact containing the
exact source SHA, version, and registry digest. Staging consumes that artifact,
checks out the matching source/chart, deploys the image by digest, and checks
`/api/health`. Manual deployments resolve the supplied tag to the same immutable
identity.

## Production (Phase 4)

`.github/workflows/deploy-production.yml` is manual-only and targets the
`production` GitHub Environment. Configure required reviewers on that
Environment to enforce approval before a production job can run.

Inputs:

- `version`: stable image tag to deploy (or the previous stable tag for rollback)
- `action`: `deploy` or `rollback` (both use the same pinned-image path)

Required `production` Environment configuration:

- Secret `KUBE_CONFIG_DATA`: base64-encoded kubeconfig for the production cluster
- Variable `KUBE_NAMESPACE` (default: `trek-production`)
- Variable `HELM_RELEASE_NAME` (default: `trek`)
- Variable `APP_URL`: externally reachable production URL, including scheme

The production workflow never deploys `latest`. It checks out the versioned git
tag, resolves the stable image tag to a registry digest, deploys that digest,
and performs a health check. Rollback is an explicit manual deployment of a
previously known-good version, including its matching chart source.

Both deployment workflows use atomic Helm upgrades, retain bounded Helm
history, and emit Kubernetes workload/event diagnostics on failure. Application
logs are not printed by default because first-start logs may contain generated
credentials.

## Operational prerequisites

- Install/configure the `staging` and `production` GitHub Environments.
- Ensure the kubeconfig identities are namespace-scoped and can only perform
  the required Helm/Kubernetes operations.
- Ensure `APP_URL` is reachable from GitHub-hosted runners.
- Ensure the cluster already has the required PVC/StorageClass and the TREK
  secret configuration. Credentials must remain in Kubernetes/GitHub secrets;
  do not put them in values files or workflow source.

## Validation checklist

- [ ] Merge/reconcile current `main` into `dev` so `dev` contains:
  - [ ] fork-scoped `syyangv/TREK` prerelease publishing to `thvysy44/trek-fork`;
  - [ ] exact-SHA CI and Security Scan gating;
  - [ ] the `prerelease-metadata` artifact;
  - [ ] `.github/workflows/deploy-staging.yml`.
- [ ] Run CI and Security Scan successfully for the resulting exact `dev` SHA.
- [ ] Publish a prerelease from that `dev` SHA; record its source SHA, version,
  and digest.
- [ ] `staging` exposes secret `KUBE_CONFIG_DATA` and variable `APP_URL`.
- [ ] Staging deploys the recorded prerelease digest and `/api/health` succeeds.
- [x] Phase 2 stable release completed as `v3.3.1`: source/tag commit
  `63c28ff843a0e937a71640260a4f7665d0830198`, image digest
  `sha256:aeffe1614d4f84a7ddbf95ca323d72213ac753cb58c4d71550ee2306a8c68794`,
  matching GitHub Release assets, and Helm chart `3.3.1` are verified. Runtime
  health evidence remains part of the staging/production deployment checks.
- [ ] `production` exposes secret `KUBE_CONFIG_DATA` and variable `APP_URL`.
- [ ] Before production deployment, identify the prior known-good stable
  rollback target and verify:
  - [ ] its git tag exists and points to the expected source;
  - [ ] its Docker manifest resolves to the recorded digest;
  - [ ] its matching chart source is available;
  - [ ] the currently deployed baseline is healthy.
- [ ] Record the current Helm revision and deployed image digest.
- [ ] Production approval is granted through GitHub Environments.
- [ ] Production deploys the recorded digest and `/api/health` succeeds.
- [ ] Rollback deploys the prior known-good version/digest and health succeeds.

If this is the first production deployment and no prior known-good release
exists, rollback cannot be operationally validated. Record that limitation and
do not mark Phase 4 complete until two known-good stable releases exist and the
older one has been exercised as a rollback target.
