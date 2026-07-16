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
  passed; Security Scan
  [`29467263383`](https://github.com/syyangv/TREK/actions/runs/29467263383)
  remains in progress.

Phase 2 is not operationally complete until a subsequent stable release proves
the image manifest, Helm publication, SBOM/provenance, tag, and GitHub Release.

## Remaining Phase 2 follow-up

- Validate the complete stable-release workflow in the release fork after
  `825bf6bb` passes CI and Security Scan.
- Confirm Docker Hub exposes the Buildx SBOM/provenance attestations for the
  published manifest.
- Add any required registry-specific provenance or retention policy.
