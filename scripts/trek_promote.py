#!/usr/bin/env python3
"""Create a Git-native TREK promotion record.

This command deliberately stops before Git operations. The caller reviews the
record, signs the commit with the approved release key, and performs the normal
Git push to the protected deploy/production branch.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from trek_promotion import COMPOSE_FILES, PromotionError, build_promotion


def _path(value: str) -> Path:
    return Path(value).expanduser()


def create_record(args: argparse.Namespace) -> int:
    compose_paths = {
        COMPOSE_FILES[0]: _path(args.compose_file),
        COMPOSE_FILES[1]: _path(args.compose_override),
    }
    try:
        promotion = build_promotion(
            environment=args.environment,
            action=args.action,
            version=args.version,
            source_sha=args.source_sha,
            release_sha=args.release_sha,
            image=args.image,
            compose_paths=compose_paths,
            previous_image=args.previous_image,
        )
    except PromotionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    output = _path(args.output)
    if output.exists() and not args.force:
        print(f"error: {output} already exists; use --force only after review", file=sys.stderr)
        return 2
    output.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(promotion.to_dict(), indent=2, sort_keys=True) + "\n")
        temporary.replace(output)
    finally:
        if temporary.exists():
            temporary.unlink()
    print(f"wrote {output} for {promotion.environment} {promotion.action} {promotion.version}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create", help="create a promotion.json record")
    create.add_argument("--environment", choices=("staging", "production"), default="production")
    create.add_argument("--action", choices=("deploy", "rollback"), default="deploy")
    create.add_argument("--version", required=True)
    create.add_argument("--source-sha", required=True)
    create.add_argument("--release-sha", required=True)
    create.add_argument("--image", required=True)
    create.add_argument("--compose-file", default="docker-compose.yml")
    create.add_argument("--compose-override", default="docker-compose.override.yml")
    create.add_argument("--previous-image")
    create.add_argument("--output", default="promotion.json")
    create.add_argument("--force", action="store_true", help="replace an existing record after explicit review")
    create.set_defaults(handler=create_record)
    args = parser.parse_args()
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
