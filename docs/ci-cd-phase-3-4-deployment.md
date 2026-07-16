# CI/CD Phases 3–4: Environment Deployment

**Implementation status:** The hardened workflow set is synchronized into
`dev`. Exact-SHA CI and Security Scan passed for merge `efb6a9f8`, and
prerelease `3.4.0-pre.1` was published from that SHA. Phase 3 is being adapted
for a single-user private installation: staging uses Docker Compose on a
dedicated Tailscale host rather than Kubernetes. Validation remains pending
promotion of this workflow to `main`, staging Environment configuration, and a
successful private deployment. The stable Phase 2 release prerequisite is
satisfied by `v3.3.1`. Production remains Kubernetes-based until it is
separately refactored.

Secret values must never be written to source control or logs.

## Staging (Phase 3)

Once promoted to default branch `main`, `.github/workflows/deploy-staging.yml`
deploys a pinned prerelease image to the `staging` GitHub Environment after the
prerelease workflow succeeds. It can also be run manually with an explicit
prerelease version.

The deployment path is:

1. A GitHub-hosted ephemeral runner consumes the prerelease metadata artifact.
2. The runner joins the private tailnet with a dedicated OAuth-created tag.
3. It connects to the deployment host with pinned standard OpenSSH over the
   private Tailscale network.
4. It installs the exact checked-out Compose definitions in a versioned
   directory under `DEPLOY_PATH/.trek-ci/releases/` and deploys the registry
   image by immutable digest.
5. It verifies the container's configured image and calls `/api/health` over
   the tailnet.

### Required `staging` Environment configuration

Secrets:

- `TS_OAUTH_CLIENT_ID`: ID of a Tailscale OAuth client authorized to create
  auth keys for the staging runner tag
- `TS_OAUTH_SECRET`: secret for that Tailscale OAuth client
- `DEPLOY_SSH_PRIVATE_KEY`: dedicated, unencrypted private key for the CI
  deployment account; the workflow intentionally has no passphrase agent
- `DEPLOY_SSH_KNOWN_HOSTS`: pinned OpenSSH host-key entry for `DEPLOY_HOST`

Variables:

- `APP_URL`: tailnet-reachable TREK URL, including scheme
- `TS_TARGETS`: comma-separated Tailscale IPs or MagicDNS names that the action
  must reach before deployment; include `DEPLOY_HOST`
- `DEPLOY_HOST`: Tailscale IP or MagicDNS name of the Compose host
- `DEPLOY_USER`: non-root macOS Remote Login account authorized to run Docker
- `DEPLOY_PATH`: absolute persistent deployment directory on that host
- `TS_TAGS` (optional, default `tag:trek-staging-ci`): dedicated tag for the
  ephemeral runner
- `COMPOSE_PROJECT_NAME` (optional, default `trek`): Compose project name

No kubeconfig, Helm release, Kubernetes namespace, or Kubernetes RBAC is needed
for Phase 3.

### Host and tailnet prerequisites

The dedicated host must be online, enrolled in the tailnet, running Docker
Engine with Docker Compose v2, and have macOS Remote Login enabled for
`DEPLOY_USER`. Install only the public half of the dedicated CI key in that
account's `~/.ssh/authorized_keys`. Source-restrict the key to Tailscale's IPv4
and IPv6 ranges while also disabling forwarding and PTY features:

```text
restrict,from="100.64.0.0/10,fd7a:115c:a1e0::/48" ssh-ed25519 <public-key>
```

Do not expose TCP 22 through router port forwarding, and use the host firewall
to prevent non-Tailscale access where practical. `DEPLOY_PATH` must already
contain the protected `.env` file. The workflow preserves state in
`DEPLOY_PATH/data/` and `DEPLOY_PATH/uploads/`; it creates those directories
when absent. Do not put credentials in Compose files or GitHub variables.

The OAuth client needs only `auth_keys` write scope and permission to apply the
exact runner tag (normally `tag:trek-staging-ci`). Configure `tagOwners` so only
the OAuth identity can apply that tag. Tailnet grants/ACLs must restrict the tag
to the deployment host on TCP 22 and the required application port. OpenSSH
strict host-key checking uses `DEPLOY_SSH_KNOWN_HOSTS`; never populate it with
runtime `ssh-keyscan` output. Do not grant the CI tag access to other tailnet
nodes.

The automatic path uses the metadata artifact's exact source SHA, version, and
published registry digest. A manual deployment checks out `v<version>`, resolves
that Docker tag's current digest at dispatch time, and then uses the digest.
Prerelease Git and Docker tags must therefore remain immutable.

Before replacement, the workflow captures both the current container's
immutable configured image and the active versioned Compose definition. It
switches the `DEPLOY_PATH/.trek-ci/current` symlink only after the new container
passes image verification. A failed deployment or health check attempts to
restore both the previous definition and digest. A first deployment, locally
built image, or legacy deployment without the active symlink may have no
complete automatic rollback target. Failure diagnostics intentionally exclude
application logs because first-start output may expose generated credentials.

GitHub evaluates `workflow_run` definitions from the default branch (`main`).
Until this Compose workflow is promoted to `main`, do not publish another
prerelease: the old default-branch workflow could run instead. Promotion is the
enabling step for automatic staging deployment.

## Production (Phase 4)

`.github/workflows/deploy-production.yml` remains a manual Kubernetes/Helm
workflow targeting the `production` GitHub Environment. Configure required
reviewers on that Environment to enforce approval before a production job can
run.

Inputs:

- `version`: stable image tag to deploy (or the previous stable tag for rollback)
- `action`: `deploy` or `rollback` (both use the same pinned-image path)

Required `production` Environment configuration:

- Secret `KUBE_CONFIG_DATA`: base64-encoded kubeconfig for the production cluster
- Variable `KUBE_NAMESPACE` (default: `trek-production`)
- Variable `HELM_RELEASE_NAME` (default: `trek`)
- Variable `APP_URL`: externally reachable production URL, including scheme

The production workflow never deploys `latest`. It checks out the versioned Git
tag, resolves the stable image tag to a registry digest, deploys that digest
with an atomic Helm upgrade, and performs a health check. Production
Kubernetes requirements are unchanged by the Phase 3 Compose refactor.

## Validation checklist

- [x] Merge/reconcile current `main` into `dev` so `dev` contains fork-scoped
  prerelease publishing, exact-SHA CI/Security gating, the
  `prerelease-metadata` artifact, and the staging workflow.
- [x] CI run `29475168886` and Security Scan `29475168909` succeeded for exact
  `dev` merge SHA `efb6a9f8828a4e7d8cfe35436c658c4e725fce17`.
- [x] Prerelease run `29475396968` published `3.4.0-pre.1` from that SHA with
  digest
  `sha256:3871779f425c4363d9e2191b7a6ef861b00431a0ca8e01706e0898e29531b93d`.
- [x] Promote the reviewed Compose staging workflow to `dev`, then to default
  branch `main` (`b2ce72f1` and `abcc0053`).
- [ ] `staging` exposes secrets `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`,
  `DEPLOY_SSH_PRIVATE_KEY`, and `DEPLOY_SSH_KNOWN_HOSTS`.
- [ ] `staging` exposes variables `APP_URL`, `TS_TARGETS`, `DEPLOY_HOST`,
  `DEPLOY_USER`, and `DEPLOY_PATH` (plus optional `TS_TAGS` and
  `COMPOSE_PROJECT_NAME`).
- [ ] The deployment host has Docker Engine, Compose v2, macOS Remote Login,
  the dedicated source-restricted authorized key, no public TCP 22 exposure,
  `.env`, and persistent `data/` and `uploads/` paths configured.
- [ ] Publish a new prerelease only after the workflow is on `main`.
- [ ] Staging deploys the recorded prerelease digest and `/api/health` succeeds.
- [x] Phase 2 stable release completed as `v3.3.1`: source/tag commit
  `63c28ff843a0e937a71640260a4f7665d0830198`, image digest
  `sha256:aeffe1614d4f84a7ddbf95ca323d72213ac753cb58c4d71550ee2306a8c68794`,
  matching GitHub Release assets, and Helm repository resolution are verified.
- [ ] `production` exposes secret `KUBE_CONFIG_DATA` and variable `APP_URL`.
- [ ] Before production deployment, identify and verify the prior known-good
  stable rollback tag, digest, chart source, and healthy deployed baseline.
- [ ] Record the current production Helm revision and deployed image digest.
- [ ] Production approval is granted through GitHub Environments.
- [ ] Production deploys the recorded digest and `/api/health` succeeds.
- [ ] Production rollback deploys the prior known-good version/digest and health
  succeeds.

If this is the first production deployment and no prior known-good release
exists, rollback cannot be operationally validated. Record that limitation and
do not mark Phase 4 complete until two known-good stable releases exist and the
older one has been exercised as a rollback target.
