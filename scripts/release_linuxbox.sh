#!/usr/bin/env bash
# Build, verify and deploy TREK on linuxbox without GitHub Actions, Docker Hub or the deploy agent.
#
# Run it on linuxbox, or stream it from another machine (nothing needs to be checked out first):
#   ssh linuxbox 'bash -s -- --ref main' < scripts/release_linuxbox.sh
#
# Flow: clone/fetch the fork -> build with the legacy builder under a memory guard -> smoke-boot the image
# on throwaway data -> stop the container, back up data/, recreate it with the production flags -> verify
# health and the running image; on failure put the previous image back.
#
# Options:
#   --ref REF           branch, tag or sha to release (default: main, resolved against origin)
#   --build-only        stop after the smoke test; the live container is not touched
#   --rebuild           build even if the image tag already exists (Docker's layer cache still applies)
#   --no-cache          rebuild every layer from scratch; implies --rebuild (a real test of the memory cap)
#   (env) TREK_RELEASE_VAULT_RW_SUBDIR  e.g. 个人整理: mount that vault subfolder writable (default: whole vault
#                       read-only, or whatever writable subfolder the running container already has)
#   --allow-migrations  needed when server/src/db changed since the running version; the smoke test then
#                       boots against a copy of the live database (DB migrations cannot be undone)
#
# Settings come from TREK_RELEASE_* environment variables (see "Configuration"). The env file holds the
# container's secrets: it is only handed to `docker run --env-file`, never printed or copied.
set -euo pipefail

usage() {
  if [[ -r "$0" ]]; then sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
  else echo "see the header of scripts/release_linuxbox.sh"; fi
}

ref="main"; build_only=0; rebuild=0; no_cache=0; allow_migrations=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) ref="${2:?--ref needs a value}"; shift 2 ;;
    --build-only) build_only=1; shift ;;
    --rebuild) rebuild=1; shift ;;
    --no-cache) no_cache=1; rebuild=1; shift ;;
    --allow-migrations) allow_migrations=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# Configuration
container="${TREK_RELEASE_CONTAINER:-trek}"
app_dir="${TREK_RELEASE_APP_DIR:-$HOME/Projects/TREK}"          # holds data/ and uploads/
vault_dir="${TREK_RELEASE_VAULT_DIR:-$HOME/obsidian/syyangv}"
# Optional: one vault subfolder mounted writable on top of the read-only vault (the leave plan lives there).
vault_rw_subdir="${TREK_RELEASE_VAULT_RW_SUBDIR:-}"
env_file="${TREK_RELEASE_ENV_FILE:-$HOME/trek.env}"
network="${TREK_RELEASE_NETWORK:-trek_default}"
host_port="${TREK_RELEASE_PORT:-3000}"
smoke_port="${TREK_RELEASE_SMOKE_PORT:-3992}"
build_dir="${TREK_RELEASE_BUILD_DIR:-$HOME/trek-build}"
repo_url="${TREK_RELEASE_REPO:-https://github.com/syyangv/TREK.git}"
health_path="${TREK_RELEASE_HEALTH_PATH:-/api/health}"
health_timeout="${TREK_RELEASE_HEALTH_TIMEOUT:-90}"
preflight_mb="${TREK_RELEASE_PREFLIGHT_MB:-3500}"               # refuse to start a build below this
guard_mb="${TREK_RELEASE_GUARD_MB:-1500}"                       # kill the build below this

smoke_name="trek-release-smoke"
tmp_dirs=()

log() { printf '%s %s\n' "$(date +%T)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
mem_avail_mb() { awk '/^MemAvailable/{print int($2/1024)}' /proc/meminfo; }

cleanup() {
  docker rm -f "$smoke_name" >/dev/null 2>&1 || true
  [[ -n "${guard_pid:-}" ]] && kill "$guard_pid" 2>/dev/null || true
  for d in "${tmp_dirs[@]}"; do [[ -d "$d" ]] && rm -rf "$d"; done
}
trap cleanup EXIT

# Boot-time refusals (body contracts, route guards, schema drift) are not covered by the test suite, so the
# release looks for them in the logs. "Non-fatal migration step failed" lines are harmless and not matched.
boot_refused() { # container
  docker logs "$1" 2>&1 | grep -E 'FATAL: |Fatal: failed|Unvalidated body|Anonymous route surface|Database schema is behind'
}

# Waits for the health endpoint; gives up at once when the container has refused to boot.
wait_healthy() { # port seconds container
  local deadline=$((SECONDS + $2))
  until curl -fsS -m 3 -o /dev/null "http://127.0.0.1:$1$health_path" 2>/dev/null; do
    ((SECONDS < deadline)) || return 1
    boot_refused "$3" >/dev/null && return 1
    sleep 3
  done
}

run_trek() { # name image
  docker run -d --name "$1" --network "$network" --restart unless-stopped \
    --read-only --cap-drop ALL --cap-add CHOWN --cap-add SETUID --cap-add SETGID \
    --security-opt no-new-privileges:true --tmpfs /tmp:noexec,nosuid,size=128m \
    -p "127.0.0.1:$host_port:3000" --env-file "$env_file" \
    -v "$app_dir/data:/app/data" -v "$app_dir/uploads:/app/uploads" -v "$vault_dir:/obsidian-vault:ro" ${vault_rw_mount[@]+"${vault_rw_mount[@]}"} \
    --health-cmd 'wget -qO- http://localhost:3000/api/health' --health-interval 30s \
    --health-timeout 10s --health-start-period 15s --health-retries 3 "$2" >/dev/null
}

# Stops only this build (and containers it started) if memory runs out; never touches running services.
guard() { # tag
  local pattern="docker build --memory=3g -t $tag" started now name created
  started=$(date +%s)
  while pgrep -f "$pattern" >/dev/null; do
    if (($(mem_avail_mb) < guard_mb)); then
      log "GUARD: MemAvailable $(mem_avail_mb) MB < $guard_mb MB, stopping the build"
      pkill -TERM -f "$pattern" || true
      sleep 3
      now=$(date +%s)
      for c in $(docker ps -q); do
        name=$(docker inspect -f '{{.Name}}' "$c"); name=${name#/}
        created=$(date -d "$(docker inspect -f '{{.Created}}' "$c")" +%s)
        [[ "$name" == "$container" || "$name" == rsshub-* ]] && continue
        ((now - created <= now - started + 30)) && docker kill "$c" >/dev/null
      done
      return 0
    fi
    sleep 5
  done
}

# Everything below lives in main() and is only called on the last line: bash parses the whole function
# first, so streaming the script over ssh, or releasing from the clone it checks out, cannot cut it short.
main() {
# ---- preflight ---------------------------------------------------------------------------------------
command -v docker >/dev/null || die "docker not found"
[[ -f "$env_file" ]] || die "env file $env_file missing"
[[ "$(stat -c %a "$env_file")" == 600 ]] || die "$env_file must be mode 600"
[[ -d "$app_dir/data" && -d "$app_dir/uploads" ]] || die "$app_dir/data and uploads must exist"
[[ -d "$vault_dir" ]] || die "vault dir $vault_dir missing"
# A release must not silently close a writable vault subfolder the running container already has.
if [[ -z "$vault_rw_subdir" ]] && docker inspect "$container" >/dev/null 2>&1; then
  vault_rw_subdir=$(docker inspect -f '{{range .Mounts}}{{println .Destination}}{{end}}' "$container" | sed -n 's#^/obsidian-vault/##p' | head -1)
  [[ -z "$vault_rw_subdir" ]] || log "keeping the writable vault subfolder: $vault_rw_subdir"
fi
vault_rw_mount=()
if [[ -n "$vault_rw_subdir" ]]; then
  [[ "$vault_rw_subdir" != /* && "$vault_rw_subdir" != *..* ]] || die "TREK_RELEASE_VAULT_RW_SUBDIR must be a relative path inside the vault"
  [[ -d "$vault_dir/$vault_rw_subdir" ]] || die "writable subfolder $vault_dir/$vault_rw_subdir missing"
  vault_rw_mount=(-v "$vault_dir/$vault_rw_subdir:/obsidian-vault/$vault_rw_subdir")
fi
((preflight_mb <= $(mem_avail_mb))) || die "only $(mem_avail_mb) MB available, need $preflight_mb MB to build safely (close Obsidian/Chrome?)"

# ---- source ------------------------------------------------------------------------------------------
if [[ -d "$build_dir/.git" ]]; then git -C "$build_dir" fetch -q --tags origin
else git clone -q "$repo_url" "$build_dir"; fi
sha=$(git -C "$build_dir" rev-parse --verify -q "origin/$ref^{commit}" || git -C "$build_dir" rev-parse --verify -q "$ref^{commit}") \
  || die "cannot resolve ref '$ref'"
short=${sha:0:8}
git -C "$build_dir" checkout -q --detach "$sha"
git -C "$build_dir" clean -fdxq
tag="trek-fork:local-$short-lbx"
log "releasing $short ($(git -C "$build_dir" log -1 --format=%s "$sha")) as $tag"

# Schema changes need a conscious yes: migrations run on the live database and cannot be reversed.
prev_id=""; prev_tag=""; schema_changed=0
if docker inspect "$container" >/dev/null 2>&1; then
  prev_id=$(docker inspect -f '{{.Image}}' "$container")
  prev_tag=$(docker inspect -f '{{.Config.Image}}' "$container")
  prev_sha=$(grep -oE 'local-[0-9a-f]{7,40}' <<<"$prev_tag" | head -1 | cut -d- -f2 || true)
  if [[ -z "$prev_sha" ]] || ! git -C "$build_dir" cat-file -e "$prev_sha^{commit}" 2>/dev/null \
     || ! git -C "$build_dir" diff --quiet "$prev_sha" "$sha" -- server/src/db/migrations.ts server/src/db/schema.ts; then
    schema_changed=1
  fi
fi
if ((schema_changed && ! allow_migrations)); then
  die "the database schema may differ from the running version ($prev_tag); rerun with --allow-migrations after reviewing"
fi

# ---- build -------------------------------------------------------------------------------------------
if docker image inspect "$tag" >/dev/null 2>&1 && ((! rebuild)); then
  log "image $tag already exists, reusing it (--rebuild to force)"
else
  log "building $tag with the legacy builder, memory cap 3g, guard at ${guard_mb} MB"
  build_log="$HOME/trek-build-$short.log"
  build_extra=()
  ((no_cache)) && build_extra+=(--no-cache)
  (cd "$build_dir" && DOCKER_BUILDKIT=0 docker build --memory=3g -t "$tag" ${build_extra[@]+"${build_extra[@]}"} .) >"$build_log" 2>&1 &
  build_pid=$!
  guard "$tag" & guard_pid=$!
  wait "$build_pid" || { tail -20 "$build_log" >&2; die "build failed (full log: $build_log)"; }
  kill "$guard_pid" 2>/dev/null || true; guard_pid=""
  log "built $tag"
fi
image_id=$(docker image inspect -f '{{.Id}}' "$tag")

# ---- smoke test --------------------------------------------------------------------------------------
smoke_tmp=$(mktemp -d); tmp_dirs+=("$smoke_tmp"); mkdir "$smoke_tmp/data" "$smoke_tmp/uploads"
smoke_env=(-e NODE_ENV=production -e PORT=3000 -e "ENCRYPTION_KEY=$(openssl rand -hex 32)")
if ((schema_changed)); then
  # Real data needs the real key, so the rehearsal on a consistent copy (SQLite backup API) uses the env file.
  python3 - "$app_dir/data/travel.db" "$smoke_tmp/data/travel.db" <<'PY'
import sqlite3, sys
src, dst = sqlite3.connect(sys.argv[1]), sqlite3.connect(sys.argv[2])
with dst:
    src.backup(dst)
PY
  smoke_env=(--env-file "$env_file" -e PORT=3000)
  log "smoke test on a copy of the live database"
fi
docker rm -f "$smoke_name" >/dev/null 2>&1 || true
docker run -d --name "$smoke_name" -p "127.0.0.1:$smoke_port:3000" "${smoke_env[@]}" \
  -v "$smoke_tmp/data:/app/data" -v "$smoke_tmp/uploads:/app/uploads" "$tag" >/dev/null
wait_healthy "$smoke_port" "$health_timeout" "$smoke_name" || { docker logs "$smoke_name" 2>&1 | tail -20 >&2; die "smoke test: no healthy response"; }
if refusals=$(boot_refused "$smoke_name"); then die "smoke test: server refused a boot gate: $refusals"; fi
log "smoke test passed"
docker rm -f "$smoke_name" >/dev/null

if ((build_only)); then log "--build-only: live container untouched"; exit 0; fi

# ---- deploy ------------------------------------------------------------------------------------------
ts=$(date +%Y%m%d-%H%M%S)
backup="$app_dir/data.pre-$short-$ts"
if docker inspect "$container" >/dev/null 2>&1; then
  log "stopping $container (20s grace) so the WAL is consistent"
  docker stop -t 20 "$container" >/dev/null
fi
cp -a "$app_dir/data" "$backup"
[[ ! -f "$app_dir/data/travel.db" ]] || cmp -s "$app_dir/data/travel.db" "$backup/travel.db" || die "backup differs from travel.db"
log "backup: $backup"
docker rm -f "$container" >/dev/null 2>&1 || true
run_trek "$container" "$tag"

healthy=0
if wait_healthy "$host_port" "$health_timeout" "$container"; then
  if refusals=$(boot_refused "$container"); then log "boot refusal: $refusals" >&2
  elif [[ "$(docker inspect -f '{{.Image}}' "$container")" != "$image_id" ]]; then log "running image is not $tag" >&2
  else healthy=1; fi
fi

if ((! healthy)); then
  log "deploy FAILED, last log lines:" >&2; docker logs --tail 15 "$container" >&2 || true
  if [[ -n "$prev_id" ]]; then
    log "rolling back to $prev_tag"
    docker rm -f "$container" >/dev/null 2>&1 || true
    # Recreate from the tag when it still names that image, so the container keeps a readable version.
    rollback_ref=$prev_id
    [[ "$(docker image inspect -f '{{.Id}}' "$prev_tag" 2>/dev/null)" == "$prev_id" ]] && rollback_ref=$prev_tag
    run_trek "$container" "$rollback_ref"
    if wait_healthy "$host_port" "$health_timeout" "$container"; then
      log "rolled back; $container is healthy on the previous image"
    else
      log "ROLLBACK ALSO UNHEALTHY: restore $backup by hand" >&2
    fi
    if ((schema_changed)); then log "note: migrations already ran on the live database; the backup is the only way back" >&2; fi
  fi
  exit 1
fi

log "deployed $tag; $container healthy on port $host_port"
log "rollback: previous image ${prev_tag:-none}; data backup $backup"
}

main
