# CI/CD Phase 2 Implementation

**Status:** Implemented in `.github/workflows/docker.yml`

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

## Remaining Phase 2 follow-up

- Validate the complete stable-release workflow in the canonical repository.
- Confirm Docker Hub exposes the Buildx SBOM/provenance attestations for the
  published manifest.
- Add any required registry-specific provenance or retention policy.
