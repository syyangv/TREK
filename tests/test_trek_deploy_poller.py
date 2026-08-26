from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from trek_deploy_poller import (
    DEFAULT_REPO_URL,
    GITHUB_API_BASE,
    GitPromotionSource,
    PollerConfig,
    PromotionPoller,
    deployment_lock,
    load_config,
)
from trek_promotion import COMPOSE_FILES, PromotionError


class FakeSource:
    def __init__(self, promotion_sha: str, payload: dict[str, object], *, ancestor: bool = True):
        self.promotion_sha = promotion_sha
        self.payload = payload
        self.ancestor = ancestor
        self.release_checks = 0

    def fetch_candidate(self) -> tuple[str, dict[str, object]]:
        return self.promotion_sha, self.payload

    def verify_release(self, _promotion: object) -> None:
        self.release_checks += 1

    def is_ancestor(self, _older_sha: str, _newer_sha: str) -> bool:
        return self.ancestor


class FakeAgent:
    def __init__(self) -> None:
        self.calls: list[tuple[dict[str, str], dict[str, str] | None]] = []

    def deploy(self, payload: dict[str, str], *, expected_compose_hashes: dict[str, str] | None = None) -> dict[str, str]:
        self.calls.append((payload, expected_compose_hashes))
        return {"image": payload["image"]}


def promotion_payload() -> dict[str, object]:
    return {
        "schema": 1,
        "environment": "production",
        "action": "deploy",
        "version": "3.5.15",
        "source_ref": "v3.5.15",
        "source_sha": "a" * 40,
        "release_sha": "b" * 40,
        "image": "thvysy44/trek-fork@sha256:" + "c" * 64,
        "compose_sha256": {filename: "d" * 64 for filename in COMPOSE_FILES},
        "promoted_at": "2026-08-26T16:00:00Z",
    }


class PollerTest(unittest.TestCase):
    def test_config_defaults_to_dry_run_and_pins_the_promotion_ref(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = root / "poller.json"
            config_path.write_text(
                json.dumps(
                    {
                        "agent_config": str(root / "agent.json"),
                        "repo_url": "https://github.com/syyangv/TREK.git",
                        "repo_dir": str(root / "repo"),
                        "state_path": str(root / "state.json"),
                        "lock_path": str(root / "lock"),
                        "allowed_signers_file": str(root / "allowed_signers"),
                    }
                )
            )

            config = load_config(config_path)

            self.assertTrue(config.dry_run)
            self.assertEqual(config.promotion_ref, "refs/heads/deploy/production")
            self.assertEqual(DEFAULT_REPO_URL, "https://github.com/syyangv/TREK.git")
            self.assertEqual(GITHUB_API_BASE, "https://api.github.com/repos/syyangv/TREK")

            invalid = json.loads(config_path.read_text())
            invalid["promotion_ref"] = "refs/heads/main"
            config_path.write_text(json.dumps(invalid))
            with self.assertRaisesRegex(PromotionError, "promotion_ref"):
                load_config(config_path)

    def test_git_promotion_source_fetches_promotion_from_a_bare_remote(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = root / "remote.git"
            repo = root / "poller.git"
            subprocess.run(["git", "init", "--bare", "--quiet", str(remote)], check=True)
            promotion_path = root / "promotion.json"
            promotion_path.write_text(json.dumps(promotion_payload()))
            blob = subprocess.check_output(
                ["git", "--git-dir", str(remote), "hash-object", "-w", "--path=promotion.json", str(promotion_path)],
                text=True,
            ).strip()
            tree = subprocess.run(
                ["git", "--git-dir", str(remote), "mktree"],
                input=f"100644 blob {blob}\tpromotion.json\n",
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            commit_env = {
                **os.environ,
                "GIT_AUTHOR_NAME": "test",
                "GIT_AUTHOR_EMAIL": "test@example.com",
                "GIT_COMMITTER_NAME": "test",
                "GIT_COMMITTER_EMAIL": "test@example.com",
            }
            commit = subprocess.check_output(
                ["git", "--git-dir", str(remote), "commit-tree", tree, "-m", "test promotion"],
                env=commit_env,
                text=True,
            ).strip()
            subprocess.run(
                ["git", "--git-dir", str(remote), "update-ref", "refs/heads/deploy/production", commit],
                check=True,
            )
            allowed_signers = root / "allowed_signers"
            allowed_signers.write_text("test@example.com ssh-ed25519 AAAA\n")
            allowed_signers.chmod(0o600)
            config = PollerConfig(
                agent_config=root / "agent.json",
                repo_url=str(remote),
                promotion_ref="refs/heads/deploy/production",
                promotion_path="promotion.json",
                repo_dir=repo,
                state_path=root / "state.json",
                lock_path=root / "lock",
                allowed_signers_file=allowed_signers,
                environment="production",
            )
            source = GitPromotionSource(config)
            source._verify_commit_signature = lambda _sha: None  # type: ignore[method-assign]

            fetched_sha, raw = source.fetch_candidate()

            self.assertEqual(fetched_sha, commit)
            self.assertEqual(raw, promotion_payload())

    def test_corrupt_state_is_rejected_before_release_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            state_path.write_text(json.dumps({"schema": 1, "unexpected": True}))
            source = FakeSource("e" * 40, promotion_payload())
            poller = PromotionPoller(
                agent=FakeAgent(), source=source, state_path=state_path, environment="production", dry_run=True
            )

            with self.assertRaisesRegex(PromotionError, "state fields"):
                poller.poll_once()
            self.assertEqual(source.release_checks, 0)

    def test_executor_failure_does_not_advance_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            initial = {
                "schema": 1,
                "promotion_sha": "e" * 40,
                "version": "3.5.14",
                "image": "thvysy44/trek-fork@sha256:" + "9" * 64,
                "updated_at": "2026-08-26T15:00:00Z",
            }
            state_path.write_text(json.dumps(initial))

            class FailingAgent(FakeAgent):
                def deploy(
                    self,
                    payload: dict[str, str],
                    *,
                    expected_compose_hashes: dict[str, str] | None = None,
                ) -> dict[str, str]:
                    raise RuntimeError("deployment failed")

            agent = FailingAgent()
            poller = PromotionPoller(
                agent=agent,
                source=FakeSource("f" * 40, promotion_payload()),
                state_path=state_path,
                environment="production",
                dry_run=False,
            )

            with self.assertRaisesRegex(RuntimeError, "deployment failed"):
                poller.poll_once()

            self.assertEqual(json.loads(state_path.read_text()), initial)

    def test_deployment_lock_rejects_contention(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            lock_path = Path(directory) / "poller.lock"
            with deployment_lock(lock_path), self.assertRaisesRegex(
                PromotionError, "another TREK deployment poller"
            ), deployment_lock(lock_path):
                pass

    def test_dry_run_verifies_candidate_without_deploying_or_writing_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            agent = FakeAgent()
            source = FakeSource("e" * 40, promotion_payload())
            poller = PromotionPoller(
                agent=agent, source=source, state_path=state_path, environment="production", dry_run=True
            )

            result = poller.poll_once()

            self.assertEqual(result["status"], "candidate")
            self.assertEqual(source.release_checks, 1)
            self.assertEqual(agent.calls, [])
            self.assertFalse(state_path.exists())

    def test_live_poller_bootstraps_only_the_explicit_current_promotion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            promotion_sha = "e" * 40
            agent = FakeAgent()
            source = FakeSource(promotion_sha, promotion_payload())
            poller = PromotionPoller(
                agent=agent,
                source=source,
                state_path=state_path,
                environment="production",
                bootstrap_promotion_sha=promotion_sha,
                dry_run=False,
            )

            result = poller.poll_once()

            self.assertEqual(result["status"], "bootstrapped")
            self.assertEqual(agent.calls, [])
            state = json.loads(state_path.read_text())
            self.assertEqual(state["promotion_sha"], promotion_sha)

    def test_live_poller_deploys_fast_forward_candidate_with_compose_hashes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            previous_sha = "e" * 40
            current_sha = "f" * 40
            state_path.write_text(
                json.dumps(
                    {
                        "schema": 1,
                        "promotion_sha": previous_sha,
                        "version": "3.5.14",
                        "image": "thvysy44/trek-fork@sha256:" + "9" * 64,
                        "updated_at": "2026-08-26T15:00:00Z",
                    }
                )
            )
            agent = FakeAgent()
            source = FakeSource(current_sha, promotion_payload())
            poller = PromotionPoller(
                agent=agent, source=source, state_path=state_path, environment="production", dry_run=False
            )

            result = poller.poll_once()

            self.assertEqual(result["status"], "deployed")
            self.assertEqual(len(agent.calls), 1)
            self.assertEqual(agent.calls[0][1], promotion_payload()["compose_sha256"])
            self.assertEqual(json.loads(state_path.read_text())["promotion_sha"], current_sha)

    def test_rewritten_promotion_ref_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            state_path.write_text(
                json.dumps(
                    {
                        "schema": 1,
                        "promotion_sha": "e" * 40,
                        "version": "3.5.14",
                        "image": "thvysy44/trek-fork@sha256:" + "9" * 64,
                        "updated_at": "2026-08-26T15:00:00Z",
                    }
                )
            )
            source = FakeSource("f" * 40, promotion_payload(), ancestor=False)
            poller = PromotionPoller(
                agent=FakeAgent(), source=source, state_path=state_path, environment="production", dry_run=False
            )

            with self.assertRaisesRegex(PromotionError, "moved backwards"):
                poller.poll_once()

    def test_same_promotion_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            promotion_sha = "e" * 40
            state_path.write_text(
                json.dumps(
                    {
                        "schema": 1,
                        "promotion_sha": promotion_sha,
                        "version": "3.5.15",
                        "image": promotion_payload()["image"],
                        "updated_at": "2026-08-26T16:00:00Z",
                    }
                )
            )
            source = FakeSource(promotion_sha, promotion_payload())
            agent = FakeAgent()
            poller = PromotionPoller(
                agent=agent, source=source, state_path=state_path, environment="production", dry_run=False
            )

            result = poller.poll_once()

            self.assertEqual(result["status"], "unchanged")
            self.assertEqual(agent.calls, [])
            self.assertEqual(source.release_checks, 0)


if __name__ == "__main__":
    unittest.main()
