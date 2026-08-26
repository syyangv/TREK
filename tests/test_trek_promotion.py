from __future__ import annotations

import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from trek_promotion import (
    COMPOSE_FILES,
    PromotionError,
    build_promotion,
    validate_promotion,
    validate_release_provenance,
)


class PromotionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.source_sha = "a" * 40
        self.release_sha = "b" * 40
        self.image = "thvysy44/trek-fork@sha256:" + "c" * 64
        self.timestamp = "2026-08-26T16:00:00Z"

    def payload(self) -> dict[str, object]:
        return {
            "schema": 1,
            "environment": "production",
            "action": "deploy",
            "version": "3.5.15",
            "source_ref": "v3.5.15",
            "source_sha": self.source_sha,
            "release_sha": self.release_sha,
            "image": self.image,
            "compose_sha256": {filename: "d" * 64 for filename in COMPOSE_FILES},
            "promoted_at": self.timestamp,
        }

    def test_validates_production_promotion(self) -> None:
        promotion = validate_promotion(self.payload(), environment="production")

        self.assertEqual(promotion.version, "3.5.15")
        self.assertEqual(promotion.deploy_payload("e" * 40)["request_id"], "promotion-" + "e" * 40)

    def test_rejects_unknown_fields_and_mismatched_tag(self) -> None:
        invalid = self.payload()
        invalid["unexpected"] = True
        with self.assertRaisesRegex(PromotionError, "fields"):
            validate_promotion(invalid)

        invalid = self.payload()
        invalid["source_ref"] = "v3.5.14"
        with self.assertRaisesRegex(PromotionError, "source_ref"):
            validate_promotion(invalid)

    def test_builds_compose_hashes_from_release_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            compose = root / COMPOSE_FILES[0]
            override = root / COMPOSE_FILES[1]
            compose.write_bytes(b"services:\n  app:\n    image: example\n")
            override.write_bytes(b"services:\n  app:\n    environment:\n      TEST: 1\n")

            promotion = build_promotion(
                environment="production",
                action="deploy",
                version="3.5.15",
                source_sha=self.source_sha,
                release_sha=self.release_sha,
                image=self.image,
                compose_paths={
                    COMPOSE_FILES[0]: compose,
                    COMPOSE_FILES[1]: override,
                },
                promoted_at=self.timestamp,
            )

            self.assertEqual(
                promotion.compose_sha256[COMPOSE_FILES[0]],
                hashlib.sha256(compose.read_bytes()).hexdigest(),
            )
            self.assertNotIn("previous_image", promotion.to_dict())

    def test_rejects_invalid_compose_hash(self) -> None:
        invalid = self.payload()
        invalid["compose_sha256"] = {COMPOSE_FILES[0]: "d" * 64, COMPOSE_FILES[1]: "not-a-hash"}
        with self.assertRaisesRegex(PromotionError, "docker-compose.override.yml"):
            validate_promotion(invalid)

    def test_rollback_requires_the_current_image(self) -> None:
        invalid = self.payload()
        invalid["action"] = "rollback"
        with self.assertRaisesRegex(PromotionError, "current image"):
            validate_promotion(invalid)

    def test_release_provenance_must_match_the_promotion(self) -> None:
        promotion = validate_promotion(self.payload(), environment="production")
        provenance = {
            "schema": 1,
            "version": promotion.version,
            "source_ref": promotion.source_ref,
            "source_sha": promotion.source_sha,
            "release_sha": promotion.release_sha,
            "image": promotion.image,
            "compose_sha256": promotion.compose_sha256,
        }
        validate_release_provenance(provenance, promotion)

        provenance["image"] = "thvysy44/trek-fork@sha256:" + "e" * 64
        with self.assertRaisesRegex(PromotionError, "image"):
            validate_release_provenance(provenance, promotion)

    def test_release_provenance_rejects_an_empty_image(self) -> None:
        promotion = validate_promotion(self.payload(), environment="production")
        provenance = {
            "schema": 1,
            "version": promotion.version,
            "source_ref": promotion.source_ref,
            "source_sha": promotion.source_sha,
            "release_sha": promotion.release_sha,
            "image": "",
            "compose_sha256": promotion.compose_sha256,
        }

        with self.assertRaisesRegex(PromotionError, "image"):
            validate_release_provenance(provenance, promotion)


if __name__ == "__main__":
    unittest.main()
