from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from trek_promotion import COMPOSE_FILES, PromotionError
from trek_release_provenance import build_provenance, write_provenance


class ReleaseProvenanceTest(unittest.TestCase):
    def test_builds_digest_bound_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            compose = root / COMPOSE_FILES[0]
            override = root / COMPOSE_FILES[1]
            compose.write_text("services:\n  app:\n    image: example\n")
            override.write_text("services:\n  app:\n    restart: always\n")

            payload = build_provenance(
                version="3.5.17",
                source_sha="a" * 40,
                release_sha="b" * 40,
                image_digest="sha256:" + "c" * 64,
                compose_paths={COMPOSE_FILES[0]: compose, COMPOSE_FILES[1]: override},
            )

            self.assertEqual(payload["image"], "thvysy44/trek-fork@sha256:" + "c" * 64)
            self.assertEqual(payload["source_ref"], "v3.5.17")
            self.assertEqual(set(payload["compose_sha256"]), set(COMPOSE_FILES))

    def test_writes_valid_json_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {filename: root / filename for filename in COMPOSE_FILES}
            for path in paths.values():
                path.write_text("services:\n")
            payload = build_provenance(
                version="3.5.17",
                source_sha="a" * 40,
                release_sha="b" * 40,
                image_digest="sha256:" + "c" * 64,
                compose_paths=paths,
            )
            output = root / "nested" / "release.json"

            write_provenance(payload, output)

            self.assertEqual(json.loads(output.read_text()), payload)
            self.assertEqual(list(output.parent.glob(".*.tmp")), [])

    def test_rejects_invalid_digest_or_compose_material(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {filename: root / filename for filename in COMPOSE_FILES}
            paths[COMPOSE_FILES[0]].write_text("services:\n")
            paths[COMPOSE_FILES[1]].write_text("")
            with self.assertRaisesRegex(PromotionError, "image digest"):
                build_provenance(
                    version="3.5.17",
                    source_sha="a" * 40,
                    release_sha="b" * 40,
                    image_digest="latest",
                    compose_paths=paths,
                )
            with self.assertRaisesRegex(PromotionError, "Compose file size"):
                build_provenance(
                    version="3.5.17",
                    source_sha="a" * 40,
                    release_sha="b" * 40,
                    image_digest="sha256:" + "c" * 64,
                    compose_paths=paths,
                )


if __name__ == "__main__":
    unittest.main()
