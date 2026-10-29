#!/usr/bin/env bash
# ADR 0015 / #73 local Docker rehearsal — nine steps through ponder-deploy.sh.
# One non-interactive command; writes a log. Do not poll; read the log when it exits.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="${PONDER_REHEARSAL_OUT:-$ROOT/.ponder-rehearsal-out}"
LOG="$OUT/rehearsal.log"
mkdir -p "$OUT"
exec > >(tee -a "$LOG") 2>&1

echo "=== ponder rehearsal start $(date -u +%Y-%m-%dT%H:%M:%SZ) root=$ROOT ==="
echo "head=$(git rev-parse HEAD)"

export PONDER_DEPLOY_ROOT="$ROOT"
export PONDER_STATE_FILE="$OUT/state.json"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-rehearsal}"
export DATABASE_URL="postgresql://ponder:${POSTGRES_PASSWORD}@postgres:5432/kargain_ponder"
export PONDER_ENABLE_LOCAL=1
export PONDER_LOCAL_ONLY=1
# Host Hardhat for deploy + window discovery; container writers use docker DNS.
export PONDER_RPC_URL_31337="${PONDER_RPC_URL_31337:-http://127.0.0.1:8545}"
# Probe owner requires PONDER_RPC_URLS_<id> (no invented default). Slot preflight
# runs inside Compose, so list the docker-reachable URL.
export PONDER_RPC_URLS_31337="${PONDER_RPC_URLS_31337:-http://host.docker.internal:8545}"
# One Compose project for legacy writer + new stack (Amendment rule 6).
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-kargain-rehearsal}"

# Relative paths — absolute COMPOSE_FILE with ':' is treated as one path on some Compose builds.
use_compose() {
  export COMPOSE_FILE="$1"
  echo "COMPOSE_FILE=$COMPOSE_FILE COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME"
}

# Postgres bootstrap before start/window are known — base compose only.
use_compose "docker-compose.yml"

step_dir() {
  local n="$1"
  mkdir -p "$OUT/step-$n"
  echo "$OUT/step-$n"
}

capture() {
  local dir="$1"
  docker compose ps >"$dir/compose-ps.txt" || true
  docker compose exec -T postgres \
    psql -U ponder -d kargain_ponder -t -A -c \
    "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY 1;" \
    >"$dir/pg_namespace.txt" 2>/dev/null || true
  if [ -f "$PONDER_STATE_FILE" ]; then
    cp "$PONDER_STATE_FILE" "$dir/state.json"
  else
    echo "(missing)" >"$dir/state.json"
  fi
}

run_deploy() {
  local op="$1" event="$2" sha="$3"
  export OPERATION="$op" EVENT_NAME="$event" DEPLOY_SHA="$sha"
  export IDENTITY_DIGEST="${IDENTITY_DIGEST:-rehearsal-identity}"
  export EXECUTABLE_DIGEST="${EXECUTABLE_DIGEST:-exec-$sha}"
  "$ROOT/scripts/ponder-deploy.sh"
}

echo "=== bootstrap legacy writer @ 25689e1 ==="
docker compose up -d postgres
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U ponder -d kargain_ponder >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Worktree outside the repo so leftover trees cannot trip lint/typecheck walks.
SCRATCH="${TMPDIR:-/tmp}/kargain-rehearsal-scratch-$$"
rm -rf "$SCRATCH"
git worktree remove --force "$SCRATCH" 2>/dev/null || true
git worktree add --detach "$SCRATCH" 25689e1d
SCRATCH2=""
cleanup_rehearsal_worktrees() {
  if [ -n "${SCRATCH2:-}" ]; then
    git worktree remove --force "$SCRATCH2" 2>/dev/null || true
    rm -rf "$SCRATCH2"
    git branch -D "rehearsal-second-$HEAD_SHA" 2>/dev/null || true
  fi
  git worktree remove --force "$SCRATCH" 2>/dev/null || true
  rm -rf "$SCRATCH"
}
trap cleanup_rehearsal_worktrees EXIT
(
  cd "$SCRATCH"
  printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD" >.env
  docker build -f Dockerfile.ponder -t "kargain-ponder:legacy-base" .
)

if ! curl -sf -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  http://127.0.0.1:8545 >/dev/null 2>&1; then
  echo "starting local Hardhat for rehearsal"
  pnpm exec hardhat node --hostname 127.0.0.1 --port 8545 >"$OUT/hardhat.log" 2>&1 &
  echo $! >"$OUT/hardhat.pid"
  for i in $(seq 1 60); do
    if curl -sf -X POST -H 'content-type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
      http://127.0.0.1:8545 >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

echo "=== deploy local stack; set start/window from registry deployment blocks ==="
pnpm deploy:local
# Host-reachable URL for creation-block discovery against Hardhat.
PONDER_RPC_URL_31337=http://127.0.0.1:8545 \
  eval "$(node --import tsx scripts/rehearsal-local-window.ts)"
: "${PONDER_START_BLOCK_31337:?PONDER_START_BLOCK_31337 unset after local window}"
: "${PONDER_GETLOGS_BLOCK_RANGE_31337:?PONDER_GETLOGS_BLOCK_RANGE_31337 unset after local window}"
export PONDER_START_BLOCK_31337 PONDER_GETLOGS_BLOCK_RANGE_31337
echo "PONDER_START_BLOCK_31337=$PONDER_START_BLOCK_31337"
echo "PONDER_GETLOGS_BLOCK_RANGE_31337=$PONDER_GETLOGS_BLOCK_RANGE_31337"
# Writers inside Compose reach Hardhat via docker DNS; keep singular in sync.
export PONDER_RPC_URL_31337=http://host.docker.internal:8545

PRE_CUTOVER_REL=".ponder-rehearsal-out/docker-compose.pre-cutover.yml"
cat >"$PRE_CUTOVER_REL" <<EOF
services:
  ponder:
    image: kargain-ponder:legacy-base
    pull_policy: never
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://ponder:\${POSTGRES_PASSWORD}@postgres:5432/kargain_ponder
      DATABASE_SCHEMA: kargain
      PONDER_ENABLE_LOCAL: "1"
      PONDER_LOCAL_ONLY: "1"
      PONDER_RPC_URL_31337: http://host.docker.internal:8545
      PONDER_RPC_URLS_31337: http://host.docker.internal:8545
      PONDER_START_BLOCK_31337: "${PONDER_START_BLOCK_31337}"
      PONDER_GETLOGS_BLOCK_RANGE_31337: "${PONDER_GETLOGS_BLOCK_RANGE_31337}"
    ports:
      - "127.0.0.1:42069:42069"
    networks:
      - kargain
EOF

# Base + rehearsal slot env + legacy ponder override — one project.
PRE_CUTOVER_COMPOSE="docker-compose.yml:ops/rehearsal/docker-compose.rehearsal.yml:${PRE_CUTOVER_REL}"
use_compose "$PRE_CUTOVER_COMPOSE"
docker compose stop ponder ponder-blue ponder-green 2>/dev/null || true
docker compose up -d postgres ponder
printf '%s\n' '{"identity":"rehearsal-identity","executable":"exec-legacy"}' >"$PONDER_STATE_FILE"

HEAD_SHA="$(git rev-parse HEAD)"
COMMIT2="$(git rev-parse HEAD)"

REHEARSAL_COMPOSE="docker-compose.yml:ops/rehearsal/docker-compose.rehearsal.yml"

step() {
  local n="$1" title="$2"
  mkdir -p "$OUT/step-$n"
  echo ""
  echo "=== $n. $title ==="
}

step 1 "push pre-cutover → awaiting_dispatch"
use_compose "$PRE_CUTOVER_COMPOSE"
run_deploy deploy push "$HEAD_SHA" | tee "$OUT/step-1/executor.txt"
capture "$OUT/step-1"
grep -q 'cutover=awaiting_dispatch' "$OUT/step-1/executor.txt"

step 2 "hold → blue pending then ready"
# Same project and compose: labelled legacy ponder + rehearsal slot env.
rm -rf .ponder-upstream.conf
printf 'set $ponder_upstream http://ponder-blue:42069;\n' >.ponder-upstream.conf
run_deploy hold workflow_dispatch "$HEAD_SHA" | tee "$OUT/step-2/executor.txt"
capture "$OUT/step-2"

step 3 "deploy → first switch"
# Drop the legacy ponder override so up_nginx brings the pinned image; the
# still-running legacy container keeps compose labels until stop_legacy.
use_compose "$REHEARSAL_COMPOSE"
run_deploy deploy workflow_dispatch "$HEAD_SHA" | tee "$OUT/step-3/executor.txt"
capture "$OUT/step-3"

step 4 "rollback → legacy spare"
run_deploy rollback workflow_dispatch "$HEAD_SHA" | tee "$OUT/step-4/executor.txt"
capture "$OUT/step-4"

step 5 "deploy → switch again"
run_deploy deploy workflow_dispatch "$HEAD_SHA" | tee "$OUT/step-5/executor.txt"
capture "$OUT/step-5"

step 6 "second commit → switch + retention"
SCRATCH2="${TMPDIR:-/tmp}/kargain-rehearsal-scratch2-$$"
rm -rf "$SCRATCH2"
git worktree remove --force "$SCRATCH2" 2>/dev/null || true
git worktree add "$SCRATCH2" -b "rehearsal-second-$HEAD_SHA" HEAD
(
  cd "$SCRATCH2"
  echo "// rehearsal build_id bump $(date -u +%s)" >>src/lib/ponder-writer-schema.ts
  git add src/lib/ponder-writer-schema.ts
  git -c user.email=rehearsal@local -c user.name=rehearsal \
    commit -m "rehearsal: bump writer schema comment for build_id"
  git rev-parse HEAD >"$OUT/second-sha.txt"
)
SECOND_SHA="$(cat "$OUT/second-sha.txt")"
docker build -f "$SCRATCH2/Dockerfile.ponder" \
  --build-arg "KARGAIN_PONDER_COMMIT=$SECOND_SHA" \
  -t "kargain-ponder:$SECOND_SHA" "$SCRATCH2"
export EXECUTABLE_DIGEST="exec-${SECOND_SHA}-2"
run_deploy deploy workflow_dispatch "$SECOND_SHA" | tee "$OUT/step-6/executor.txt"
capture "$OUT/step-6"

step 7 "restart live writer without nginx reload"
LIVE_SLOT="$(node --import tsx scripts/ponder-deploy-state-cli.ts --live-slot "$PONDER_STATE_FILE" --pre-cutover 0 | tr -d '\r' || true)"
LIVE_SLOT="${LIVE_SLOT:-blue}"
docker compose restart "ponder-$LIVE_SLOT"
START_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
ok=0
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:42069/ready" || true)"
  if [ "$code" = "200" ] || [ "$code" = "503" ]; then
    ok=1
    break
  fi
  sleep 0.5
done
END_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
ELAPSED=$((END_MS - START_MS))
echo "nginx_recovery_ms=$ELAPSED recovered=$ok bound_ms=10000" | tee "$OUT/step-7/executor.txt"
capture "$OUT/step-7"
test "$ok" = "1"
test "$ELAPSED" -le 10000

step 8 "not-ready pending superseded"
export EXECUTABLE_DIGEST="exec-pending-stale"
mkdir -p "$OUT/step-8a"
run_deploy hold workflow_dispatch "$HEAD_SHA" | tee "$OUT/step-8a/executor.txt" || true
export EXECUTABLE_DIGEST="exec-pending-newer"
run_deploy deploy workflow_dispatch "$SECOND_SHA" | tee "$OUT/step-8/executor.txt"
capture "$OUT/step-8"

step 9 "state file removed → deploy_state_invalid"
rm -f "$PONDER_STATE_FILE"
set +e
run_deploy deploy workflow_dispatch "$HEAD_SHA" >"$OUT/step-9/executor.txt" 2>&1
ec=$?
set -e
capture "$OUT/step-9"
cat "$OUT/step-9/executor.txt"
grep -q 'deploy_state_invalid' "$OUT/step-9/executor.txt"
test "$ec" -ne 0

echo "=== rehearsal complete head=$HEAD_SHA ==="
