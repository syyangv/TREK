# CI/CD Phase 2 Implementation

**Status:** Implemented; operational validation in progress

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

## Operational validation status

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
- No stable release has completed after those successful post-fix gates.
- Stable release run
  [`29470814108`](https://github.com/syyangv/TREK/actions/runs/29470814108)
  passed exact-SHA CI/security verification but stopped before publication when
  protected `main` rejected the generated version commit. The workflow now uses
  a temporary release-build branch instead of bypassing branch protection.

Phase 2 is not operationally complete until a subsequent stable release proves
the image manifest, Helm publication, SBOM/provenance, tag, and GitHub Release.

## Remaining Phase 2 follow-up

- After this documentation PR merges, require successful CI and Security Scan
  for the exact current `main` SHA containing `825bf6bb`, then validate the
  complete stable-release workflow for that head. Do not dispatch against a
  newer `main` using evidence from `825bf6bb` alone.
- Confirm Docker Hub exposes the Buildx SBOM/provenance attestations for the
  published manifest.
- Add any required registry-specific provenance or retention policy.
