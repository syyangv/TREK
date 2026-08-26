#!/usr/bin/env python3
"""Create the compact provenance record attached to a stable TREK release."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path

from trek_promotion import (
    COMPOSE_FILES,
    SHA256_RE,
    SHA_RE,
    STABLE_VERSION_RE,
    PromotionError,
)

IMAGE_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
MAX_COMPOSE_BYTES = 1024 * 1024


def _compose_hash(path: Path, filename: str) -> str:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise PromotionError(f"unable to read Compose file: {filename}") from exc
    if not data or len(data) > MAX_COMPOSE_BYTES:
        raise PromotionError(f"Compose file size is invalid: {filename}")
    digest = hashlib.sha256(data).hexdigest()
    if not SHA256_RE.fullmatch(digest):
        raise PromotionError(f"Compose hash is invalid: {filename}")
    return digest


def build_provenance(
    *,
    version: str,
    source_sha: str,
    release_sha: str,
    image_digest: str,
    compose_paths: dict[str, Path],
) -> dict[str, object]:
    """Build and validate the stable release provenance payload."""
    if not STABLE_VERSION_RE.fullmatch(version):
        raise PromotionError("release version is invalid")
    if not SHA_RE.fullmatch(source_sha) or not SHA_RE.fullmatch(release_sha):
        raise PromotionError("release source or release SHA is invalid")
    if not IMAGE_DIGEST_RE.fullmatch(image_digest):
        raise PromotionError("release image digest is invalid")
    if set(compose_paths) != set(COMPOSE_FILES):
        raise PromotionError("both approved Compose files are required")

    return {
        "schema": 1,
        "version": version,
        "source_ref": f"v{version}",
        "source_sha": source_sha,
        "release_sha": release_sha,
        "image": f"thvysy44/trek-fork@{image_digest}",
        "compose_sha256": {
            filename: _compose_hash(compose_paths[filename], filename) for filename in COMPOSE_FILES
        },
    }


def write_provenance(payload: dict[str, object], output: Path) -> None:
    """Write JSON atomically so a partial record cannot be uploaded."""
    output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        temporary.replace(output)
    finally:
        if temporary.exists():
            temporary.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--release-sha", required=True)
    parser.add_argument("--image-digest", required=True)
    parser.add_argument("--compose-file", default=COMPOSE_FILES[0])
    parser.add_argument("--compose-override", default=COMPOSE_FILES[1])
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    try:
        payload = build_provenance(
            version=args.version,
            source_sha=args.source_sha,
            release_sha=args.release_sha,
            image_digest=args.image_digest,
            compose_paths={
                COMPOSE_FILES[0]: Path(args.compose_file),
                COMPOSE_FILES[1]: Path(args.compose_override),
            },
        )
        write_provenance(payload, Path(args.output))
    except PromotionError as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
