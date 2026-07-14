# CI/CD Phases 3–4: Environment Deployment

## Staging (Phase 3)

`.github/workflows/deploy-staging.yml` deploys a pinned prerelease image to the
`staging` GitHub Environment after the prerelease workflow succeeds. It can also
be run manually with an explicit prerelease version.

Required `staging` Environment configuration:

- Secret `KUBE_CONFIG_DATA`: base64-encoded kubeconfig for the staging cluster
- Variable `KUBE_NAMESPACE` (default: `trek-staging`)
- Variable `HELM_RELEASE_NAME` (default: `trek`)
- Variable `APP_URL`: externally reachable staging URL, including scheme

The workflow waits for the Helm rollout, verifies the deployment image is the
requested immutable prerelease tag, and checks `/api/health`.

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

The production workflow never deploys `latest`; it verifies the exact stable
tag after rollout and performs a health check. Rollback is an explicit manual
deployment of a previously known-good stable tag.

## Operational prerequisites

- Install/configure the `staging` and `production` GitHub Environments.
- Ensure the kubeconfig identities are namespace-scoped and can only perform
  the required Helm/Kubernetes operations.
- Ensure `APP_URL` is reachable from GitHub-hosted runners.
- Ensure the cluster already has the required PVC/StorageClass and the TREK
  secret configuration. Credentials must remain in Kubernetes/GitHub secrets;
  do not put them in values files or workflow source.
