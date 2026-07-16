# CI/CD Phase 2 Implementation

**Status:** Implemented and operationally validated (2026-07-16)

Phase 2 hardens the stable release path without rebuilding the image between
artifact publication and release:

- Docker Buildx emits SBOM and maximum-detail SLSA provenance attestations for
  each platform image.
- The merge job creates the multi-architecture manifest and exports its raw
  OCI manifest JSON as a retained workflow artifact.
- The release job generates a CycloneDX SBOM for the versioned image and
  publishes it with the GitHub Release.
- GitHub Releases use `--generate-notes`, so release notes are derived from
  the previous release automatically.
- The release asset includes the exact multi-architecture manifest metadata,
  making the published tag-to-digest mapping auditable.

The release job runs only after unified CI and security verification, version
bump metadata, multi-architecture manifest creation, and Helm publication
succeed. Every build and publication job checks out the exact generated release
commit rather than mutable `main`. The GitHub Release creates the `vX.Y.Z` tag
only after the image, manifest metadata, SBOM, and Helm chart are available.
The generated version commit is pushed to temporary branch
`release-build/vX.Y.Z`, not protected `main`; the release tag makes that commit
permanent and the temporary branch is deleted after publication succeeds.
Retries reuse an existing version branch only when it has the expected parent
SHA and complete deterministically generated tree. Retained workflow artifacts are uploaded before a draft
release is published; the resulting tag target is verified, and branch cleanup
is non-fatal. A later run recognizes a published tag that still has its matching
temporary branch as an ambiguously completed transaction only when its parent
is the exact currently validated `main` SHA. Older stale branches are cleaned
without suppressing a release for newer `main`.

## Operational validation evidence

- CI passed for hardening merge `5210ff4d`.
- Security Scan rerun
  [`29466975090`](https://github.com/syyangv/TREK/actions/runs/29466975090)
  passed for that exact SHA.
- Stable release run
  [`29467183250`](https://github.com/syyangv/TREK/actions/runs/29467183250)
  stopped before versioning or artifact publication because the verifier selected
  an earlier failed Security Scan instead of the later successful rerun.
- Fix `825bf6bb` changes the verifier to accept a successful required run for the
  exact SHA without allowing a prior failed attempt to permanently poison that
  commit. CI run
  [`29467234562`](https://github.com/syyangv/TREK/actions/runs/29467234562)
  passed. Full manual CI run
  [`29467262444`](https://github.com/syyangv/TREK/actions/runs/29467262444)
  also passed. Security Scan
  [`29467263383`](https://github.com/syyangv/TREK/actions/runs/29467263383)
  and push Security run
  [`29467234565`](https://github.com/syyangv/TREK/actions/runs/29467234565)
  passed for the fix.
- Stable release run
  [`29470814108`](https://github.com/syyangv/TREK/actions/runs/29470814108)
  passed exact-SHA CI/security verification but stopped before publication when
  protected `main` rejected the generated version commit. The workflow now uses
  a temporary release-build branch instead of bypassing branch protection.
- Docker Hub target correction PR
  [`#4`](https://github.com/syyangv/TREK/pull/4) aligned publishing, SBOM,
  deployment verification, local override, and documentation with the
  configured repository `thvysy44/trek-fork`. Required PR checks passed and an
  independent senior-engineer review found no material issues. The correction
  merged as `1542658d8f883cc61edf3812d1487b141b006c5d`.
- Exact-SHA CI
  [`29472255851`](https://github.com/syyangv/TREK/actions/runs/29472255851)
  and Security Scan
  [`29472255877`](https://github.com/syyangv/TREK/actions/runs/29472255877)
  passed for that merge commit.
- Stable release run
  [`29472255838`](https://github.com/syyangv/TREK/actions/runs/29472255838)
  attempt 2 completed successfully after the workflow safely rejected and an
  operator removed the stale temporary branch from the earlier failed base.
- GitHub Release
  [`v3.3.1`](https://github.com/syyangv/TREK/releases/tag/v3.3.1) is published,
  is neither draft nor prerelease, and its tag points to generated release
  commit `63c28ff843a0e937a71640260a4f7665d0830198`.
- Release assets include `trek-3.3.1-manifest.json` and
  `trek-3.3.1-sbom.cdx.json`.
- Docker tags `3.3.1`, `3`, and `latest` all resolve to OCI index digest
  `sha256:aeffe1614d4f84a7ddbf95ca323d72213ac753cb58c4d71550ee2306a8c68794`.
  The index contains native `linux/amd64` and `linux/arm64` images plus their
  Buildx attestation manifests.
- GitHub Pages is enabled from the root of `gh-pages`. Both
  `https://syyangv.github.io/TREK/index.yaml` and chart package
  `https://syyangv.github.io/TREK/trek-3.3.1.tgz` return HTTP 200. An isolated
  Helm client test successfully completed `helm repo add`, `helm repo update`,
  and `helm show chart ... --version 3.3.1`, resolving chart and app version
  `3.3.1`.
- The successful cleanup job removed `release-build/v3.3.1` after publication.

Phase 2 is operationally complete. Registry retention policy remains an
operator-level maintenance decision rather than a release-validation blocker.
