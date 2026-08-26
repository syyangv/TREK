#!/usr/bin/env bash
set -euo pipefail

# Installs the outbound-only promotion poller next to the existing break-glass
# deployment agent. The poller starts in dry-run mode; an operator must review
# and explicitly change poller.json before it can deploy anything.

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
install_root="$HOME/.local/share/trek-deploy-agent"
config_root="$HOME/.config/trek-deploy-agent"
log_root="$HOME/Library/Logs/trek-deploy-agent"
launch_agents="$HOME/Library/LaunchAgents"
label="com.syang.trek-deploy-poller"
plist="$launch_agents/$label.plist"
config="$config_root/poller.json"
agent_config="${TREK_AGENT_CONFIG:-$config_root/config.json}"
python_bin="$(command -v python3)"

[[ -f "$agent_config" ]] || {
  echo "Existing TREK agent config is required: $agent_config" >&2
  exit 1
}

allowed_signers_file="${TREK_ALLOWED_SIGNERS_FILE:-$config_root/allowed_signers}"
[[ -f "$allowed_signers_file" ]] || {
  echo "Create the owner-readable SSH allowed-signers file first: $allowed_signers_file" >&2
  exit 1
}

agent_state_root="$(python3 - "$agent_config" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    config = json.load(handle)
print(config["state_root"])
PY
)"

mkdir -p "$install_root" "$config_root" "$log_root" "$launch_agents" "$agent_state_root"
chmod 700 "$install_root" "$config_root" "$log_root" "$agent_state_root"
install -m 700 "$repo_root/scripts/trek_deploy_agent.py" "$install_root/trek_deploy_agent.py"
install -m 700 "$repo_root/scripts/trek_promotion.py" "$install_root/trek_promotion.py"
install -m 700 "$repo_root/scripts/trek_deploy_poller.py" "$install_root/trek_deploy_poller.py"

if [[ ! -f "$config" ]]; then
  AGENT_CONFIG="$agent_config" \
REPO_URL="${TREK_PROMOTION_REPO_URL:-https://github.com/syyangv/TREK.git}" \
  PROMOTION_REF="${TREK_PROMOTION_REF:-refs/heads/deploy/production}" \
  PROMOTION_PATH="${TREK_PROMOTION_PATH:-promotion.json}" \
  REPO_DIR="${TREK_PROMOTION_REPO_DIR:-$agent_state_root/promotion-repo}" \
  STATE_PATH="${TREK_PROMOTION_STATE_PATH:-$agent_state_root/poller-state.json}" \
  LOCK_PATH="${TREK_PROMOTION_LOCK_PATH:-$agent_state_root/poller.lock}" \
  ALLOWED_SIGNERS_FILE="$allowed_signers_file" \
  ENVIRONMENT="${TREK_PROMOTION_ENVIRONMENT:-production}" \
  POLL_INTERVAL="${TREK_PROMOTION_POLL_INTERVAL:-60}" \
  python3 - <<'PY' > "$config"
import json
import os

payload = {
    "agent_config": os.environ["AGENT_CONFIG"],
    "repo_url": os.environ["REPO_URL"],
    "promotion_ref": os.environ["PROMOTION_REF"],
    "promotion_path": os.environ["PROMOTION_PATH"],
    "repo_dir": os.environ["REPO_DIR"],
    "state_path": os.environ["STATE_PATH"],
    "lock_path": os.environ["LOCK_PATH"],
    "allowed_signers_file": os.environ["ALLOWED_SIGNERS_FILE"],
    "environment": os.environ["ENVIRONMENT"],
    "poll_interval_seconds": int(os.environ["POLL_INTERVAL"]),
    "dry_run": True,
}
print(json.dumps(payload, indent=2, sort_keys=True))
PY
  chmod 600 "$config"
fi

cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$python_bin</string>
    <string>$install_root/trek_deploy_poller.py</string>
    <string>--config</string>
    <string>$config</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$log_root/poller-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$log_root/poller-stderr.log</string>
</dict>
</plist>
PLIST
chmod 600 "$plist"
plutil -lint "$plist" >/dev/null

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
launchctl kickstart -k "gui/$(id -u)/$label"

echo "TREK promotion poller installed in dry-run mode."
echo "Review $config, bootstrap the current promotion, then set dry_run to false only after shadow validation."
