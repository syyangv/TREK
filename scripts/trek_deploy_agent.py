#!/usr/bin/env python3
"""Restricted, HMAC-authenticated TREK deployment service.

The service intentionally exposes no command, path, or environment input. It
fetches Compose definitions from syyangv/TREK at a constrained git ref and runs
a fixed Docker Compose deployment by immutable image digest.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

IMAGE_RE = re.compile(r"^thvysy44/trek-fork@sha256:[0-9a-f]{64}$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
STAGING_VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+-pre\.[0-9]+$")
STABLE_VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
TAG_RE = re.compile(r"^v[0-9]+\.[0-9]+\.[0-9]+(?:-pre\.[0-9]+)?$")
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
MAX_BODY = 16 * 1024
MAX_COMPOSE = 1024 * 1024
AUTH_WINDOW_SECONDS = 300


class DeployError(RuntimeError):
    pass


class Agent:
    def __init__(self, config_path: Path):
        config = json.loads(config_path.read_text())
        self.token = config["token"].encode()
        if len(self.token) < 32:
            raise ValueError("deployment token must contain at least 32 characters")
        self.deploy_path = Path(config["deploy_path"]).expanduser().resolve()
        self.state_root = Path(config.get("state_root", self.deploy_path / ".trek-deploy-agent")).expanduser().resolve()
        self.docker = config.get("docker_path", "/usr/local/bin/docker")
        self.compose_plugin = config.get(
            "compose_plugin", "/Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose"
        )
        self.project = config.get("compose_project_name", "trek")
        self.container = config.get("container_name", "trek")
        self.health_url = config.get("health_url", "http://127.0.0.1:3000/api/health")
        self.raw_base = config.get("raw_base", "https://raw.githubusercontent.com/syyangv/TREK")
        self.command_timeout = int(config.get("command_timeout_seconds", 360))
        # Local health traffic must never be sent through a system proxy.
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self._lock = threading.Lock()
        self._nonce_lock = threading.Lock()
        self._nonces: dict[str, int] = {}
        self._prepare_runtime()

    def _prepare_runtime(self) -> None:
        if not self.deploy_path.is_dir() or not (self.deploy_path / ".env").is_file():
            raise ValueError("deploy_path must exist and contain .env")
        if not os.access(self.docker, os.X_OK):
            raise ValueError(f"Docker executable not found: {self.docker}")
        if not os.access(self.compose_plugin, os.X_OK):
            raise ValueError(f"Compose plugin not found: {self.compose_plugin}")
        self.state_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.docker_home = self.state_root / "docker-home"
        self.docker_config = self.state_root / "docker-config"
        plugin_dir = self.docker_config / "cli-plugins"
        self.docker_home.mkdir(mode=0o700, exist_ok=True)
        plugin_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        config_path = self.docker_config / "config.json"
        config_path.write_text('{"auths":{"https://index.docker.io/v1/":{"auth":"YW5vbnltb3VzOg=="}}}\n')
        config_path.chmod(0o600)
        plugin_link = plugin_dir / "docker-compose"
        if plugin_link.is_symlink() or plugin_link.exists():
            plugin_link.unlink()
        plugin_link.symlink_to(self.compose_plugin)

    def authenticate(self, timestamp: str, nonce: str, signature: str, body: bytes) -> None:
        try:
            stamp = int(timestamp)
        except ValueError as exc:
            raise DeployError("invalid authentication timestamp") from exc
        now = int(time.time())
        if abs(now - stamp) > AUTH_WINDOW_SECONDS:
            raise DeployError("authentication timestamp expired")
        if not REQUEST_ID_RE.fullmatch(nonce):
            raise DeployError("invalid authentication nonce")
        expected = hmac.new(self.token, timestamp.encode() + b"\n" + nonce.encode() + b"\n" + body, hashlib.sha256).hexdigest()
        supplied = signature.removeprefix("sha256=")
        if not hmac.compare_digest(expected, supplied):
            raise DeployError("invalid authentication signature")
        with self._nonce_lock:
            self._nonces = {key: seen for key, seen in self._nonces.items() if now - seen <= AUTH_WINDOW_SECONDS}
            if nonce in self._nonces:
                raise DeployError("authentication nonce already used")
            self._nonces[nonce] = now

    def validate_request(self, payload: dict[str, Any]) -> dict[str, str]:
        allowed = {"environment", "action", "version", "source_ref", "image", "request_id"}
        if set(payload) != allowed or not all(isinstance(payload[key], str) for key in allowed):
            raise DeployError("request fields are invalid")
        environment = payload["environment"]
        action = payload["action"]
        version = payload["version"]
        source_ref = payload["source_ref"]
        if environment not in {"staging", "production"}:
            raise DeployError("environment must be staging or production")
        if action not in {"deploy", "rollback"}:
            raise DeployError("action must be deploy or rollback")
        expected_re = STAGING_VERSION_RE if environment == "staging" else STABLE_VERSION_RE
        if not expected_re.fullmatch(version):
            raise DeployError("version is invalid for the requested environment")
        if source_ref != f"v{version}" and not SHA_RE.fullmatch(source_ref):
            raise DeployError("source_ref must be the matching tag or a full source SHA")
        if source_ref.startswith("v") and not TAG_RE.fullmatch(source_ref):
            raise DeployError("source tag is invalid")
        if not IMAGE_RE.fullmatch(payload["image"]):
            raise DeployError("image must be the approved repository pinned by sha256 digest")
        if not REQUEST_ID_RE.fullmatch(payload["request_id"]):
            raise DeployError("request_id is invalid")
        return payload

    def _docker_env(self, image: str | None = None) -> dict[str, str]:
        env = {
            "HOME": str(self.docker_home),
            "PATH": "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "DOCKER_CONFIG": str(self.docker_config),
        }
        if image:
            env["TREK_IMAGE"] = image
        return env

    def _run(self, args: list[str], *, image: str | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            args,
            cwd=self.deploy_path,
            env=self._docker_env(image),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=self.command_timeout,
            check=False,
        )
        if check and result.returncode:
            tail = "\n".join(result.stdout.splitlines()[-20:])
            print(f"deployment command failed: {args!r}\n{tail}", flush=True)
            raise DeployError("deployment command failed; inspect the local agent log")
        return result

    def _fetch(self, source_ref: str, filename: str) -> bytes:
        ref = urllib.parse.quote(source_ref, safe="")
        url = f"{self.raw_base}/{ref}/{filename}"
        try:
            # The Mac has nonfunctional outbound IPv6. Python's HTTP stack can
            # remain in SYN_SENT for minutes, while curl's explicit IPv4 path
            # fails fast and keeps the source fetch deterministic.
            result = subprocess.run(
                [
                    "/usr/bin/curl",
                    "--ipv4",
                    "--fail",
                    "--silent",
                    "--show-error",
                    "--location",
                    "--max-time",
                    "30",
                    "--max-filesize",
                    str(MAX_COMPOSE),
                    url,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=35,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise DeployError(f"unable to fetch {filename} from approved repository") from exc
        if result.returncode:
            raise DeployError(f"unable to fetch {filename} from approved repository")
        data = result.stdout
        if not data or len(data) > MAX_COMPOSE:
            raise DeployError(f"invalid {filename} size")
        return data

    def _compose_command(self, release_dir: Path) -> list[str]:
        return [
            self.docker,
            "--config",
            str(self.docker_config),
            "compose",
            "--project-directory",
            str(self.deploy_path),
            "-p",
            self.project,
            "-f",
            str(release_dir / "docker-compose.yml"),
            "-f",
            str(release_dir / "docker-compose.override.yml"),
        ]

    def _current_target(self, environment: str) -> tuple[Path, str] | None:
        link = self.state_root / environment / "current"
        if not link.is_symlink():
            return None
        release_dir = (link.parent / os.readlink(link)).resolve()
        allowed_root = (self.state_root / environment / "releases").resolve()
        if release_dir.parent != allowed_root:
            return None
        try:
            metadata = json.loads((release_dir / "metadata.json").read_text())
        except (OSError, json.JSONDecodeError):
            return None
        image = metadata.get("image", "")
        return (release_dir, image) if IMAGE_RE.fullmatch(image) else None

    def _deploy_release(self, release_dir: Path, image: str) -> None:
        self._run([self.docker, "--config", str(self.docker_config), "pull", image])
        compose = self._compose_command(release_dir)
        rendered = self._run(compose + ["config", "--images"], image=image).stdout.strip()
        if rendered != image:
            raise DeployError("Compose definition did not resolve to the requested digest")
        self._run(compose + ["up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "300", "app"], image=image)
        actual = self._run([self.docker, "inspect", "--format", "{{.Config.Image}}", self.container]).stdout.strip()
        if actual != image:
            raise DeployError("running container image does not match requested digest")
        try:
            with self._opener.open(self.health_url, timeout=15) as response:
                if response.status != HTTPStatus.OK:
                    raise DeployError("local health check failed")
        except (urllib.error.URLError, TimeoutError) as exc:
            raise DeployError("local health check failed") from exc

    def deploy(self, payload: dict[str, Any]) -> dict[str, str]:
        request = self.validate_request(payload)
        if not self._lock.acquire(blocking=False):
            raise DeployError("another deployment is already running")
        try:
            environment = request["environment"]
            env_root = self.state_root / environment
            releases = env_root / "releases"
            releases.mkdir(mode=0o700, parents=True, exist_ok=True)
            release_dir = releases / request["request_id"]
            if release_dir.exists():
                raise DeployError("request_id already exists")
            previous = self._current_target(environment)
            release_dir.mkdir(mode=0o700)
            try:
                (release_dir / "docker-compose.yml").write_bytes(self._fetch(request["source_ref"], "docker-compose.yml"))
                (release_dir / "docker-compose.override.yml").write_bytes(
                    self._fetch(request["source_ref"], "docker-compose.override.yml")
                )
                metadata = {key: request[key] for key in ("environment", "action", "version", "source_ref", "image", "request_id")}
                (release_dir / "metadata.json").write_text(json.dumps(metadata, sort_keys=True) + "\n")
                self._deploy_release(release_dir, request["image"])
            except Exception as deployment_error:
                if previous:
                    try:
                        self._deploy_release(*previous)
                    except Exception as rollback_error:
                        print(f"automatic recovery failed: {rollback_error}", flush=True)
                        raise DeployError("deployment and automatic recovery failed; inspect the local agent log") from deployment_error
                raise
            next_link = env_root / f"current.{secrets.token_hex(8)}"
            next_link.symlink_to(Path("releases") / release_dir.name)
            os.replace(next_link, env_root / "current")
            return metadata
        finally:
            self._lock.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "trek-deploy-agent/1"

    @property
    def agent(self) -> Agent:
        return self.server.agent  # type: ignore[attr-defined]

    def _json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, sort_keys=True).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in {"/healthz", "/__trek-deploy/healthz"}:
            self._json(HTTPStatus.OK, {"status": "ok"})
        else:
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") not in {"/deploy", "/__trek-deploy/deploy"}:
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                raise DeployError("invalid request size")
            body = self.rfile.read(length)
            self.agent.authenticate(
                self.headers.get("X-Trek-Timestamp", ""),
                self.headers.get("X-Trek-Nonce", ""),
                self.headers.get("X-Trek-Signature", ""),
                body,
            )
            payload = json.loads(body)
            if not isinstance(payload, dict):
                raise DeployError("request body must be an object")
            result = self.agent.deploy(payload)
            self._json(HTTPStatus.OK, {"status": "deployed", **result})
        except (DeployError, json.JSONDecodeError) as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal deployment error"})

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8786)
    args = parser.parse_args()
    agent = Agent(args.config)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.agent = agent  # type: ignore[attr-defined]
    server.serve_forever()


if __name__ == "__main__":
    main()
