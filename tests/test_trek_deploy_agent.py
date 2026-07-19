from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import tempfile
import time
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "scripts" / "trek_deploy_agent.py"
SPEC = importlib.util.spec_from_file_location("trek_deploy_agent", MODULE_PATH)
assert SPEC and SPEC.loader
agent_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(agent_module)


class AgentTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        deploy_path = root / "deploy"
        deploy_path.mkdir()
        (deploy_path / ".env").write_text("TEST=1\n")
        docker = root / "docker"
        compose = root / "docker-compose"
        docker.write_text("#!/bin/sh\nexit 0\n")
        compose.write_text("#!/bin/sh\nexit 0\n")
        docker.chmod(0o700)
        compose.chmod(0o700)
        self.token = "a" * 64
        config = root / "config.json"
        config.write_text(
            json.dumps(
                {
                    "token": self.token,
                    "deploy_path": str(deploy_path),
                    "state_root": str(root / "state"),
                    "docker_path": str(docker),
                    "compose_plugin": str(compose),
                }
            )
        )
        self.agent = agent_module.Agent(config)

    def tearDown(self) -> None:
        self.temp.cleanup()

    @staticmethod
    def request(environment: str = "staging") -> dict[str, str]:
        prerelease = environment == "staging"
        version = "3.5.0-pre.1" if prerelease else "3.5.0"
        return {
            "environment": environment,
            "action": "deploy",
            "version": version,
            "source_ref": f"v{version}",
            "image": "thvysy44/trek-fork@sha256:" + "e" * 64,
            "request_id": "run-123-1",
        }

    def test_validates_environment_specific_versions(self) -> None:
        self.assertEqual(self.agent.validate_request(self.request())["environment"], "staging")
        self.assertEqual(self.agent.validate_request(self.request("production"))["environment"], "production")
        invalid = self.request("production")
        invalid["version"] = "3.5.0-pre.1"
        invalid["source_ref"] = "v3.5.0-pre.1"
        with self.assertRaisesRegex(agent_module.DeployError, "version is invalid"):
            self.agent.validate_request(invalid)

    def test_rejects_unapproved_images_and_extra_fields(self) -> None:
        invalid = self.request()
        invalid["image"] = "example.invalid/trek@sha256:" + "e" * 64
        with self.assertRaisesRegex(agent_module.DeployError, "approved repository"):
            self.agent.validate_request(invalid)
        invalid = self.request()
        invalid["command"] = "id"
        with self.assertRaisesRegex(agent_module.DeployError, "fields are invalid"):
            self.agent.validate_request(invalid)

    def test_hmac_authentication_and_replay_protection(self) -> None:
        body = json.dumps(self.request(), sort_keys=True).encode()
        timestamp = str(int(time.time()))
        nonce = "nonce-123"
        signature = hmac.new(
            self.token.encode(), timestamp.encode() + b"\n" + nonce.encode() + b"\n" + body, hashlib.sha256
        ).hexdigest()
        self.agent.authenticate(timestamp, nonce, f"sha256={signature}", body)
        with self.assertRaisesRegex(agent_module.DeployError, "already used"):
            self.agent.authenticate(timestamp, nonce, f"sha256={signature}", body)

    def test_records_only_successful_release_as_current(self) -> None:
        request = self.request()
        self.agent._fetch = lambda _ref, filename: f"# {filename}\n".encode()  # type: ignore[method-assign]
        self.agent._deploy_release = lambda _release, _image: None  # type: ignore[method-assign]
        result = self.agent.deploy(request)
        self.assertEqual(result["image"], request["image"])
        current = self.agent._current_target("staging")
        self.assertIsNotNone(current)
        assert current
        self.assertEqual(current[1], request["image"])

    def test_failed_release_does_not_advance_current(self) -> None:
        request = self.request()
        self.agent._fetch = lambda _ref, filename: f"# {filename}\n".encode()  # type: ignore[method-assign]
        self.agent._deploy_release = lambda _release, _image: (_ for _ in ()).throw(agent_module.DeployError("failed"))  # type: ignore[method-assign]
        with self.assertRaises(agent_module.DeployError):
            self.agent.deploy(request)
        self.assertIsNone(self.agent._current_target("staging"))

    def test_reports_failed_automatic_recovery(self) -> None:
        first = self.request()
        self.agent._fetch = lambda _ref, filename: f"# {filename}\n".encode()  # type: ignore[method-assign]
        self.agent._deploy_release = lambda _release, _image: None  # type: ignore[method-assign]
        self.agent.deploy(first)
        second = self.request()
        second["request_id"] = "run-124-1"
        self.agent._deploy_release = lambda _release, _image: (_ for _ in ()).throw(agent_module.DeployError("failed"))  # type: ignore[method-assign]
        with self.assertRaisesRegex(agent_module.DeployError, "automatic recovery failed"):
            self.agent.deploy(second)
        current = self.agent._current_target("staging")
        self.assertIsNotNone(current)
        assert current
        self.assertEqual(current[0].name, first["request_id"])


if __name__ == "__main__":
    unittest.main()
