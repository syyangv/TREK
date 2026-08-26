#!/usr/bin/env python3
"""Pull and deploy signed TREK production promotions.

The poller is deliberately outbound-only. It fetches a protected promotion
branch, verifies its signed commit and release binding, then reuses the
restricted local deployment agent. It never checks out or executes repository
source, and it defaults to shadow mode when configured by the installer.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import subprocess
import sys
import time
import urllib.parse
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from trek_deploy_agent import Agent
from trek_promotion import (
    IMAGE_RE,
    SHA_RE,
    Promotion,
    PromotionError,
    validate_promotion,
    validate_release_provenance,
)

DEFAULT_REPO_URL = "https://github.com/syangv/TREK.git"
DEFAULT_PROMOTION_PATH = "promotion.json"
DEFAULT_POLL_INTERVAL_SECONDS = 60
MIN_POLL_INTERVAL_SECONDS = 15
MAX_PROMOTION_BYTES = 16 * 1024
MAX_API_BYTES = 256 * 1024
STATE_SCHEMA = 1
GITHUB_API_BASE = "https://api.github.com/repos/syangv/TREK"
REQUIRED_WORKFLOWS = frozenset(("CI", "Security Scan"))


@dataclass(frozen=True)
class PollerConfig:
    agent_config: Path
    repo_url: str
    promotion_ref: str
    promotion_path: str
    repo_dir: Path
    state_path: Path
    lock_path: Path
    allowed_signers_file: Path
    environment: str
    poll_interval_seconds: int = DEFAULT_POLL_INTERVAL_SECONDS
    bootstrap_promotion_sha: str | None = None
    dry_run: bool = True
    git_timeout_seconds: int = 60


def _path(value: object, key: str) -> Path:
    if not isinstance(value, str) or not value:
        raise PromotionError(f"poller config field {key} is invalid")
    return Path(value).expanduser().resolve()


def load_config(path: Path) -> PollerConfig:
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise PromotionError("unable to read poller config") from exc
    if not isinstance(payload, dict):
        raise PromotionError("poller config must be a JSON object")

    environment = payload.get("environment", "production")
    if environment not in {"staging", "production"}:
        raise PromotionError("poller environment is invalid")
    expected_ref = f"refs/heads/deploy/{environment}"
    promotion_ref = payload.get("promotion_ref", expected_ref)
    if promotion_ref != expected_ref:
        raise PromotionError("poller promotion_ref is invalid")
    promotion_path = payload.get("promotion_path", DEFAULT_PROMOTION_PATH)
    if promotion_path != DEFAULT_PROMOTION_PATH:
        raise PromotionError("poller promotion_path is invalid")

    repo_url = payload.get("repo_url", DEFAULT_REPO_URL)
    if repo_url != DEFAULT_REPO_URL:
        raise PromotionError("poller repo_url is not the approved TREK repository")

    try:
        interval = int(payload.get("poll_interval_seconds", DEFAULT_POLL_INTERVAL_SECONDS))
        git_timeout = int(payload.get("git_timeout_seconds", 60))
    except (TypeError, ValueError) as exc:
        raise PromotionError("poller timing configuration is invalid") from exc
    if interval < MIN_POLL_INTERVAL_SECONDS or git_timeout < 10:
        raise PromotionError("poller timing configuration is too small")

    bootstrap = payload.get("bootstrap_promotion_sha")
    if bootstrap == "":
        bootstrap = None
    if bootstrap is not None and (not isinstance(bootstrap, str) or not SHA_RE.fullmatch(bootstrap)):
        raise PromotionError("bootstrap promotion SHA is invalid")
    dry_run = payload.get("dry_run", True)
    if not isinstance(dry_run, bool):
        raise PromotionError("poller dry_run setting is invalid")

    return PollerConfig(
        agent_config=_path(payload.get("agent_config"), "agent_config"),
        repo_url=repo_url,
        promotion_ref=promotion_ref,
        promotion_path=promotion_path,
        repo_dir=_path(payload.get("repo_dir"), "repo_dir"),
        state_path=_path(payload.get("state_path"), "state_path"),
        lock_path=_path(payload.get("lock_path"), "lock_path"),
        allowed_signers_file=_path(payload.get("allowed_signers_file"), "allowed_signers_file"),
        environment=environment,
        poll_interval_seconds=interval,
        bootstrap_promotion_sha=bootstrap,
        dry_run=dry_run,
        git_timeout_seconds=git_timeout,
    )


class GitPromotionSource:
    """Read only the signed promotion branch and the referenced release tag."""

    def __init__(self, config: PollerConfig):
        self.config = config
        self.repo_dir = config.repo_dir
        self.repo_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._ensure_repo()

    def _run(
        self,
        args: list[str],
        *,
        check: bool = True,
        git_config: tuple[str, ...] = (),
    ) -> subprocess.CompletedProcess[str]:
        command = ["git", "-c", "core.hooksPath=/dev/null"]
        for item in git_config:
            command.extend(["-c", item])
        command.extend(["--git-dir", str(self.repo_dir), *args])
        env = os.environ.copy()
        env["GIT_CONFIG_NOSYSTEM"] = "1"
        env["GIT_CONFIG_GLOBAL"] = os.devnull
        env["GIT_TERMINAL_PROMPT"] = "0"
        env["GIT_OPTIONAL_LOCKS"] = "0"
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                env=env,
                timeout=self.config.git_timeout_seconds,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise PromotionError("git promotion operation failed") from exc
        if check and result.returncode != 0:
            raise PromotionError("git promotion operation failed")
        return result

    def _ensure_repo(self) -> None:
        if not (self.repo_dir / "HEAD").is_file():
            try:
                result = subprocess.run(
                    ["git", "-c", "core.hooksPath=/dev/null", "init", "--bare", "--quiet", str(self.repo_dir)],
                    capture_output=True,
                    text=True,
                    timeout=self.config.git_timeout_seconds,
                    check=False,
                )
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise PromotionError("unable to initialize promotion repository") from exc
            if result.returncode != 0:
                raise PromotionError("unable to initialize promotion repository")

        remote = self._run(["remote", "get-url", "origin"], check=False).stdout.strip()
        if not remote:
            self._run(["remote", "add", "origin", self.config.repo_url])
        elif remote != self.config.repo_url:
            raise PromotionError("promotion repository remote is not approved")

    def _fetch_url(self, url: str, *, accept: str = "application/vnd.github+json") -> bytes:
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname != "api.github.com":
            raise PromotionError("GitHub API URL is not approved")
        try:
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
                    str(MAX_API_BYTES),
                    "--header",
                    f"Accept: {accept}",
                    "--header",
                    "X-GitHub-Api-Version: 2022-11-28",
                    url,
                ],
                capture_output=True,
                timeout=35,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise PromotionError("GitHub API request failed") from exc
        if result.returncode != 0 or not result.stdout or len(result.stdout) > MAX_API_BYTES:
            raise PromotionError("GitHub API request failed")
        return result.stdout

    def _api_json(self, path: str) -> dict[str, object]:
        raw = self._fetch_url(f"{GITHUB_API_BASE}{path}")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise PromotionError("GitHub API returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise PromotionError("GitHub API returned an invalid object")
        return payload

    def _rev_parse(self, ref: str) -> str:
        value = self._run(["rev-parse", ref]).stdout.strip()
        if not SHA_RE.fullmatch(value):
            raise PromotionError("git returned an invalid commit SHA")
        return value

    def _verify_commit_signature(self, commit_sha: str) -> None:
        if not self.config.allowed_signers_file.is_file():
            raise PromotionError("approved signer file is missing")
        try:
            mode = self.config.allowed_signers_file.stat().st_mode & 0o777
        except OSError as exc:
            raise PromotionError("approved signer file is unreadable") from exc
        if mode & 0o022:
            raise PromotionError("approved signer file must not be group or world writable")
        self._run(
            ["verify-commit", "--raw", commit_sha],
            git_config=(
                "gpg.format=ssh",
                f"gpg.ssh.allowedSignersFile={self.config.allowed_signers_file}",
            ),
        )

    def fetch_candidate(self) -> tuple[str, dict[str, object]]:
        remote_ref = "refs/remotes/origin/deploy-promotion"
        self._run(
            [
                "fetch",
                "--quiet",
                "--no-tags",
                "--force",
                "origin",
                f"{self.config.promotion_ref}:{remote_ref}",
            ]
        )
        commit_sha = self._rev_parse(remote_ref)
        self._verify_commit_signature(commit_sha)
        raw = self._run(["show", f"{commit_sha}:{self.config.promotion_path}"]).stdout
        if not raw or len(raw.encode()) > MAX_PROMOTION_BYTES:
            raise PromotionError("promotion record size is invalid")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise PromotionError("promotion record is not valid JSON") from exc
        if not isinstance(payload, dict):
            raise PromotionError("promotion record must be a JSON object")
        return commit_sha, payload

    def verify_release(self, promotion: Promotion) -> None:
        tag_ref = f"refs/tags/{promotion.source_ref}"
        self._run(
            [
                "fetch",
                "--quiet",
                "--no-tags",
                "--force",
                "--depth",
                "2",
                "origin",
                f"{tag_ref}:{tag_ref}",
            ]
        )
        release_sha = self._rev_parse(f"{tag_ref}^{{}}")
        if release_sha != promotion.release_sha:
            raise PromotionError("release tag does not match the promoted release SHA")
        parent_sha = self._rev_parse(f"{release_sha}^")
        if parent_sha != promotion.source_sha:
            raise PromotionError("release commit is not the expected child of the gated source SHA")
        self._verify_required_workflows(promotion.source_sha)
        self._verify_release_provenance(promotion)

    def _verify_required_workflows(self, source_sha: str) -> None:
        encoded_sha = urllib.parse.quote(source_sha, safe="")
        payload = self._api_json(f"/actions/runs?head_sha={encoded_sha}&event=push&per_page=100")
        runs = payload.get("workflow_runs")
        if not isinstance(runs, list):
            raise PromotionError("GitHub workflow response is invalid")
        passed = {
            run.get("name")
            for run in runs
            if isinstance(run, dict)
            and run.get("head_sha") == source_sha
            and run.get("status") == "completed"
            and run.get("conclusion") == "success"
        }
        missing = REQUIRED_WORKFLOWS - passed
        if missing:
            raise PromotionError(f"required GitHub workflows are not successful: {', '.join(sorted(missing))}")

    def _verify_release_provenance(self, promotion: Promotion) -> None:
        encoded_tag = urllib.parse.quote(promotion.source_ref, safe="")
        release = self._api_json(f"/releases/tags/{encoded_tag}")
        if release.get("tag_name") != promotion.source_ref or release.get("draft") is not False:
            raise PromotionError("GitHub release is missing or still a draft")
        if release.get("target_commitish") != promotion.release_sha:
            raise PromotionError("GitHub release does not target the promoted release SHA")
        assets = release.get("assets")
        if not isinstance(assets, list):
            raise PromotionError("GitHub release assets are invalid")
        expected_name = f"trek-{promotion.version}-release.json"
        asset = next((item for item in assets if isinstance(item, dict) and item.get("name") == expected_name), None)
        if not isinstance(asset, dict) or not isinstance(asset.get("url"), str):
            raise PromotionError("release provenance asset is missing")
        raw = self._fetch_url(asset["url"], accept="application/octet-stream")
        try:
            provenance = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise PromotionError("release provenance asset is invalid JSON") from exc
        if not isinstance(provenance, dict):
            raise PromotionError("release provenance asset is invalid")
        validate_release_provenance(provenance, promotion)

    def is_ancestor(self, older_sha: str, newer_sha: str) -> bool:
        if not SHA_RE.fullmatch(older_sha) or not SHA_RE.fullmatch(newer_sha):
            raise PromotionError("promotion state SHA is invalid")
        result = self._run(["merge-base", "--is-ancestor", older_sha, newer_sha], check=False)
        return result.returncode == 0


def _read_state(path: Path) -> dict[str, str] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise PromotionError("poller state is unreadable") from exc
    schema = payload.get("schema") if isinstance(payload, dict) else None
    if isinstance(schema, bool) or schema != STATE_SCHEMA:
        raise PromotionError("poller state schema is invalid")
    required = {"schema", "promotion_sha", "version", "image", "updated_at"}
    if set(payload) != required:
        raise PromotionError("poller state fields are invalid")
    values = {key: payload[key] for key in required if key != "schema"}
    if not all(isinstance(value, str) and value for value in values.values()):
        raise PromotionError("poller state values are invalid")
    if not SHA_RE.fullmatch(values["promotion_sha"]) or not IMAGE_RE.fullmatch(values["image"]):
        raise PromotionError("poller state identity is invalid")
    return values


def _write_state(path: Path, promotion_sha: str, promotion: Promotion) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    payload = {
        "schema": STATE_SCHEMA,
        "promotion_sha": promotion_sha,
        "version": promotion.version,
        "image": promotion.image,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


@contextmanager
def deployment_lock(path: Path) -> Iterator[None]:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise PromotionError("another TREK deployment poller is already running") from exc
        yield
    finally:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


class PromotionPoller:
    def __init__(
        self,
        *,
        agent: Agent,
        source: GitPromotionSource,
        state_path: Path,
        environment: str,
        bootstrap_promotion_sha: str | None = None,
        dry_run: bool = True,
    ):
        self.agent = agent
        self.source = source
        self.state_path = state_path
        self.environment = environment
        self.bootstrap_promotion_sha = bootstrap_promotion_sha
        self.dry_run = dry_run

    def poll_once(self) -> dict[str, str]:
        promotion_sha, raw = self.source.fetch_candidate()
        promotion = validate_promotion(raw, environment=self.environment)
        state = _read_state(self.state_path)
        if state and state["promotion_sha"] == promotion_sha:
            return {"status": "unchanged", "promotion_sha": promotion_sha, "version": promotion.version}
        if promotion.previous_image and state and promotion.previous_image != state["image"]:
            raise PromotionError("promotion previous_image does not match deployed state")
        if promotion.action == "rollback" and state is None:
            raise PromotionError("rollback requires an initialized poller state")

        self.source.verify_release(promotion)
        if state and not self.source.is_ancestor(state["promotion_sha"], promotion_sha):
            raise PromotionError("promotion ref moved backwards or was rewritten")

        if self.dry_run:
            return {"status": "candidate", "promotion_sha": promotion_sha, "version": promotion.version}

        if state is None:
            if self.bootstrap_promotion_sha != promotion_sha:
                raise PromotionError(
                    "poller state is uninitialized; set bootstrap_promotion_sha to the approved current promotion"
                )
            _write_state(self.state_path, promotion_sha, promotion)
            return {"status": "bootstrapped", "promotion_sha": promotion_sha, "version": promotion.version}

        result = self.agent.deploy(
            promotion.deploy_payload(promotion_sha),
            expected_compose_hashes=promotion.compose_sha256,
        )
        _write_state(self.state_path, promotion_sha, promotion)
        return {
            "status": "deployed",
            "promotion_sha": promotion_sha,
            "version": promotion.version,
            "image": result["image"],
        }


def _run(poller: PromotionPoller, *, once: bool, interval: int) -> int:
    while True:
        try:
            print(json.dumps(poller.poll_once(), sort_keys=True), flush=True)
        except PromotionError as exc:
            print(f"promotion poll rejected: {exc}", file=sys.stderr, flush=True)
            if once:
                return 1
        # Keep the long-lived LaunchAgent alive across an unexpected transient
        # error; the next poll re-verifies the signed candidate from scratch.
        except Exception:  # noqa: BLE001
            print("promotion poll failed unexpectedly; retrying", file=sys.stderr, flush=True)
            if once:
                return 1
        if once:
            return 0
        time.sleep(interval)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--once", action="store_true", help="poll once and exit")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="verify but never deploy or write state")
    mode.add_argument("--apply", action="store_true", help="override config and allow deployment")
    args = parser.parse_args()

    try:
        config = load_config(args.config.expanduser().resolve())
        if args.dry_run:
            dry_run = True
        elif args.apply:
            dry_run = False
        else:
            dry_run = config.dry_run
        agent = Agent(config.agent_config)
        source = GitPromotionSource(config)
        poller = PromotionPoller(
            agent=agent,
            source=source,
            state_path=config.state_path,
            environment=config.environment,
            bootstrap_promotion_sha=config.bootstrap_promotion_sha,
            dry_run=dry_run,
        )
        with deployment_lock(config.lock_path):
            return _run(poller, once=args.once, interval=config.poll_interval_seconds)
    except PromotionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except (OSError, ValueError) as exc:
        print(f"error: poller configuration is unusable: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
