#!/usr/bin/env python3
"""Send an authenticated request to the restricted TREK deployment agent."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.error
import urllib.request


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--environment", choices=("staging", "production"), required=True)
    parser.add_argument("--action", choices=("deploy", "rollback"), default="deploy")
    parser.add_argument("--version", required=True)
    parser.add_argument("--source-ref", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--request-id", required=True)
    args = parser.parse_args()
    token = os.environ.get("TREK_DEPLOY_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("TREK_DEPLOY_TOKEN is missing or invalid")
    payload = {
        "action": args.action,
        "environment": args.environment,
        "image": args.image,
        "request_id": args.request_id,
        "source_ref": args.source_ref,
        "version": args.version,
    }
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    timestamp = str(int(time.time()))
    nonce = secrets.token_hex(16)
    signature = hmac.new(token.encode(), timestamp.encode() + b"\n" + nonce.encode() + b"\n" + body, hashlib.sha256).hexdigest()
    request = urllib.request.Request(
        args.url.rstrip("/") + "/deploy",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Trek-Timestamp": timestamp,
            "X-Trek-Nonce": nonce,
            "X-Trek-Signature": f"sha256={signature}",
        },
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=420) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            detail = json.load(exc)
        except Exception:
            detail = {"error": f"HTTP {exc.code}"}
        raise SystemExit(detail.get("error", "deployment request failed")) from exc
    if result.get("status") != "deployed" or result.get("image") != args.image:
        raise SystemExit("deployment agent returned an unexpected result")
    print(json.dumps({"status": result["status"], "environment": result["environment"], "version": result["version"], "image": result["image"]}))


if __name__ == "__main__":
    main()
