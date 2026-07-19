#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
install_root="$HOME/.local/share/trek-deploy-agent"
config_root="$HOME/.config/trek-deploy-agent"
log_root="$HOME/Library/Logs/trek-deploy-agent"
launch_agents="$HOME/Library/LaunchAgents"
label="com.syang.trek-deploy-agent"
plist="$launch_agents/$label.plist"
config="$config_root/config.json"
python_bin="$(command -v python3)"
deploy_path="${TREK_DEPLOY_PATH:-$repo_root}"

mkdir -p "$install_root" "$config_root" "$log_root" "$launch_agents"
chmod 700 "$install_root" "$config_root" "$log_root"
install -m 700 "$repo_root/scripts/trek_deploy_agent.py" "$install_root/trek_deploy_agent.py"
install -m 700 "$repo_root/scripts/trek_deploy_client.py" "$install_root/trek_deploy_client.py"

if [[ ! -f "$config" ]]; then
  token="$(openssl rand -hex 32)"
  TOKEN="$token" DEPLOY_PATH="$deploy_path" python3 - <<'PY' > "$config"
import json, os
print(json.dumps({
    "token": os.environ["TOKEN"],
    "deploy_path": os.environ["DEPLOY_PATH"],
    "state_root": os.path.join(os.environ["DEPLOY_PATH"], ".trek-deploy-agent"),
    "compose_project_name": "trek",
    "container_name": "trek",
    "health_url": "http://127.0.0.1:3000/api/health",
}, indent=2))
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
    <string>$install_root/trek_deploy_agent.py</string>
    <string>--config</string>
    <string>$config</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>8786</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$log_root/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$log_root/stderr.log</string>
</dict>
</plist>
PLIST
chmod 600 "$plist"
plutil -lint "$plist" >/dev/null

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
launchctl kickstart -k "gui/$(id -u)/$label"

for _ in {1..20}; do
  if curl --fail --silent http://127.0.0.1:8786/healthz >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl --fail --silent --show-error http://127.0.0.1:8786/healthz >/dev/null

# Mount the private deployment API under the existing tailnet-only HTTPS server.
tailscale serve --bg --https=443 --set-path=/__trek-deploy http://127.0.0.1:8786 >/dev/null

echo "TREK deployment agent installed and healthy."
echo "Configure GitHub secret TREK_DEPLOY_TOKEN from $config without printing it."
