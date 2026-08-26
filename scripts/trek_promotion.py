#!/usr/bin/env python3
"""Pure validation and construction helpers for Git-native TREK promotions.

The promotion record is intentionally small and declarative. It identifies the
already-built release image and the exact source/Compose material that the
production poller is allowed to deploy; it never contains credentials.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

PROMOTION_SCHEMA = 1
COMPOSE_FILES = ("docker-compose.yml", "docker-compose.override.yml")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
STAGING_VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+-pre\.[0-9]+$")
STABLE_VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
TAG_RE = re.compile(r"^v[0-9]+\.[0-9]+\.[0-9]+(?:-pre\.[0-9]+)?$")
IMAGE_RE = re.compile(r"^thvysy44/trek-fork@sha256:[0-9a-f]{64}$")
RFC3339_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)

REQUIRED_KEYS = {
    "schema",
    "environment",
    "action",
    "version",
    "source_ref",
    "source_sha",
    "release_sha",
    "image",
    "compose_sha256",
    "promoted_at",
}
OPTIONAL_KEYS = {"previous_image"}
RELEASE_PROVENANCE_KEYS = {
    "schema",
    "version",
    "source_ref",
    "source_sha",
    "release_sha",
    "image",
    "compose_sha256",
}


class PromotionError(ValueError):
    """Raised when a promotion record is not safe to evaluate or deploy."""


@dataclass(frozen=True)
class Promotion:
    schema: int
    environment: str
    action: str
    version: str
    source_ref: str
    source_sha: str
    release_sha: str
    image: str
    compose_sha256: dict[str, str]
    promoted_at: str
    previous_image: str | None = None

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "schema": self.schema,
            "environment": self.environment,
            "action": self.action,
            "version": self.version,
            "source_ref": self.source_ref,
            "source_sha": self.source_sha,
            "release_sha": self.release_sha,
            "image": self.image,
            "compose_sha256": dict(self.compose_sha256),
            "promoted_at": self.promoted_at,
        }
        if self.previous_image is not None:
            payload["previous_image"] = self.previous_image
        return payload

    def deploy_payload(self, promotion_sha: str) -> dict[str, str]:
        """Return the legacy agent payload with a deterministic request ID."""
        if not SHA_RE.fullmatch(promotion_sha):
            raise PromotionError("promotion commit SHA is invalid")
        return {
            "environment": self.environment,
            "action": self.action,
            "version": self.version,
            "source_ref": self.source_ref,
            "image": self.image,
            "request_id": f"promotion-{promotion_sha}",
        }


def _string(payload: Mapping[str, object], key: str, *, max_length: int = 256) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value or len(value) > max_length:
        raise PromotionError(f"promotion field {key} is invalid")
    return value


def validate_promotion(payload: Mapping[str, object], *, environment: str | None = None) -> Promotion:
    """Validate a decoded promotion record and return a typed immutable value."""
    if not isinstance(payload, Mapping):
        raise PromotionError("promotion must be a JSON object")
    keys = set(payload)
    if keys != REQUIRED_KEYS and keys != REQUIRED_KEYS | OPTIONAL_KEYS:
        raise PromotionError("promotion fields are invalid")

    schema = payload.get("schema")
    if isinstance(schema, bool) or schema != PROMOTION_SCHEMA:
        raise PromotionError("promotion schema is unsupported")

    actual_environment = _string(payload, "environment", max_length=32)
    if actual_environment not in {"staging", "production"}:
        raise PromotionError("promotion environment is invalid")
    if environment is not None and actual_environment != environment:
        raise PromotionError("promotion environment does not match poller")

    action = _string(payload, "action", max_length=16)
    if action not in {"deploy", "rollback"}:
        raise PromotionError("promotion action is invalid")
    if action == "rollback" and "previous_image" not in payload:
        raise PromotionError("rollback promotion must identify the current image")

    version = _string(payload, "version", max_length=64)
    version_re = STAGING_VERSION_RE if actual_environment == "staging" else STABLE_VERSION_RE
    if not version_re.fullmatch(version):
        raise PromotionError("promotion version is invalid")

    source_ref = _string(payload, "source_ref", max_length=64)
    if source_ref != f"v{version}" or not TAG_RE.fullmatch(source_ref):
        raise PromotionError("promotion source_ref must match the release tag")

    source_sha = _string(payload, "source_sha", max_length=40)
    release_sha = _string(payload, "release_sha", max_length=40)
    if not SHA_RE.fullmatch(source_sha) or not SHA_RE.fullmatch(release_sha):
        raise PromotionError("promotion source or release SHA is invalid")

    image = _string(payload, "image", max_length=128)
    if not IMAGE_RE.fullmatch(image):
        raise PromotionError("promotion image must be an approved digest")

    compose_hashes = payload.get("compose_sha256")
    if not isinstance(compose_hashes, Mapping) or set(compose_hashes) != set(COMPOSE_FILES):
        raise PromotionError("promotion Compose hashes are invalid")
    normalized_hashes: dict[str, str] = {}
    for filename in COMPOSE_FILES:
        value = compose_hashes.get(filename)
        if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
            raise PromotionError(f"promotion hash for {filename} is invalid")
        normalized_hashes[filename] = value

    promoted_at = _string(payload, "promoted_at", max_length=64)
    if not RFC3339_RE.fullmatch(promoted_at):
        raise PromotionError("promotion timestamp is invalid")
    try:
        parsed_timestamp = promoted_at.replace("Z", "+00:00")
        if datetime.fromisoformat(parsed_timestamp).tzinfo is None:
            raise ValueError
    except ValueError as exc:
        raise PromotionError("promotion timestamp is invalid") from exc

    previous_image: str | None = None
    if "previous_image" in payload:
        previous_image = payload["previous_image"]
        if not isinstance(previous_image, str) or not IMAGE_RE.fullmatch(previous_image):
            raise PromotionError("promotion previous_image is invalid")

    return Promotion(
        schema=schema,
        environment=actual_environment,
        action=action,
        version=version,
        source_ref=source_ref,
        source_sha=source_sha,
        release_sha=release_sha,
        image=image,
        compose_sha256=normalized_hashes,
        promoted_at=promoted_at,
        previous_image=previous_image,
    )


def validate_release_provenance(payload: Mapping[str, object], promotion: Promotion) -> None:
    """Validate the release asset produced by the stable image workflow."""
    if not isinstance(payload, Mapping) or set(payload) != RELEASE_PROVENANCE_KEYS:
        raise PromotionError("release provenance fields are invalid")
    schema = payload.get("schema")
    if isinstance(schema, bool) or schema != PROMOTION_SCHEMA:
        raise PromotionError("release provenance schema is unsupported")
    if payload.get("version") != promotion.version:
        raise PromotionError("release provenance version does not match promotion")
    if payload.get("source_ref") != promotion.source_ref:
        raise PromotionError("release provenance source_ref does not match promotion")
    if payload.get("source_sha") != promotion.source_sha:
        raise PromotionError("release provenance source SHA does not match promotion")
    if payload.get("release_sha") != promotion.release_sha:
        raise PromotionError("release provenance release SHA does not match promotion")
    if payload.get("image") != promotion.image:
        raise PromotionError("release provenance image does not match promotion")
    compose_hashes = payload.get("compose_sha256")
    if not isinstance(compose_hashes, Mapping) or dict(compose_hashes) != promotion.compose_sha256:
        raise PromotionError("release provenance Compose hashes do not match promotion")


def _hash_file(path: Path) -> str:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise PromotionError(f"unable to read Compose file: {path}") from exc
    if not data or len(data) > 1024 * 1024:
        raise PromotionError(f"Compose file size is invalid: {path}")
    return hashlib.sha256(data).hexdigest()


def build_promotion(
    *,
    environment: str,
    action: str,
    version: str,
    source_sha: str,
    release_sha: str,
    image: str,
    compose_paths: Mapping[str, Path],
    previous_image: str | None = None,
    promoted_at: str | None = None,
) -> Promotion:
    """Build and validate a promotion from local release Compose files."""
    if set(compose_paths) != set(COMPOSE_FILES):
        raise PromotionError("both approved Compose files are required")
    timestamp = promoted_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    payload: dict[str, object] = {
        "schema": PROMOTION_SCHEMA,
        "environment": environment,
        "action": action,
        "version": version,
        "source_ref": f"v{version}",
        "source_sha": source_sha,
        "release_sha": release_sha,
        "image": image,
        "compose_sha256": {name: _hash_file(Path(compose_paths[name])) for name in COMPOSE_FILES},
        "promoted_at": timestamp,
    }
    if previous_image is not None:
        payload["previous_image"] = previous_image
    return validate_promotion(payload, environment=environment)
