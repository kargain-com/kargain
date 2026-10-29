#!/usr/bin/env bash
# ADR 0015 / #73 local Docker rehearsal — nine steps through ponder-deploy.sh.
# Mirrors deploy-ponder.yml: checkout DEPLOY_SHA in the deploy root, digests from
# scripts/ponder-deploy-fingerprints.ts on that tree. No faked digests; no || true
# on a deploy run. One non-interactive command; writes a log.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Output + scratch outside every Docker build context (repo root COPY . .).
OUT="${PONDER_REHEARSAL_OUT:-${TMPDIR:-/tmp}/kargain-ponder-rehearsal-$$}"
LOG="$OUT/rehearsal.log"
mkdir -p "$OUT"
exec > >(tee -a "$LOG") 2>&1

ORIGINAL_HEAD="$(git rev-parse HEAD)"
ORIGINAL_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "=== ponder rehearsal start $(date -u +%Y-%m-%dT%H:%M:%SZ) root=$ROOT out=$OUT ==="
echo "head=$ORIGINAL_HEAD branch=$ORIGINAL_BRANCH"

export PONDER_DEPLOY_ROOT="$ROOT"
export PONDER_STATE_FILE="$OUT/state.json"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-rehearsal}"
export DATABASE_URL="postgresql://ponder:${POSTGRES_PASSWORD}@postgres:5432/kargain_ponder"
export PONDER_ENABLE_LOCAL=1
export PONDER_LOCAL_ONLY=1
export PONDER_RPC_URL_31337="${PONDER_RPC_URL_31337:-http://127.0.0.1:8545}"
export PONDER_RPC_URLS_31337="${PONDER_RPC_URLS_31337:-http://host.docker.internal:8545}"
# One Compose project for legacy writer + new stack (Amendment rule 6).
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-kargain-rehearsal}"

# Relative compose paths only (absolute COMPOSE_FILE + ':' is unsafe on some builds).
# Generated pre-cutover override is relative and dockerignored.
PRE_CUTOVER_REL="ops/rehearsal/.generated-pre-cutover.yml"

use_compose() {
  export COMPOSE_FILE="$1"
  echo "COMPOSE_FILE=$COMPOSE_FILE COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME"
}

# Remove only this Compose project's containers, volumes, and locally-built images.
cleanup_compose_project() {
  echo "=== cleanup compose project=$COMPOSE_PROJECT_NAME ==="
  docker compose --project-name "$COMPOSE_PROJECT_NAME" down \
    --volumes --remove-orphans --rmi local </dev/null 2>/dev/null || true
}

SCRATCH=""
HEAD_SHA=""
SECOND_SHA=""
THIRD_SHA=""
cleanup_all() {
  cleanup_compose_project
  # Restore the developer's branch after per-step DEPLOY_SHA checkouts.
  if [ -n "${ORIGINAL_BRANCH:-}" ] && [ "$ORIGINAL_BRANCH" != "HEAD" ]; then
    git checkout -B "$ORIGINAL_BRANCH" "$ORIGINAL_HEAD" >/dev/null 2>&1 || true
  elif [ -n "${ORIGINAL_HEAD:-}" ]; then
    git checkout --force "$ORIGINAL_HEAD" >/dev/null 2>&1 || true
  fi
  if [ -n "${THIRD_SHA:-}" ]; then
    git branch -D "rehearsal-third-$ORIGINAL_HEAD" 2>/dev/null || true
  fi
  if [ -n "${SECOND_SHA:-}" ]; then
    git branch -D "rehearsal-second-$ORIGINAL_HEAD" 2>/dev/null || true
  fi
  if [ -n "${SCRATCH:-}" ]; then
    git worktree remove --force "$SCRATCH" 2>/dev/null || true
    rm -rf "$SCRATCH"
  fi
  rm -f "$ROOT/$PRE_CUTOVER_REL"
}
trap cleanup_all EXIT

# Start clean: only this project.
cleanup_compose_project

use_compose "docker-compose.yml"

# Per-step evidence required by #73: stdout, pg_namespace, compose ps, state.
capture() {
  local dir="$1"
  mkdir -p "$dir"
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
  echo "--- pg_namespace ---"
  cat "$dir/pg_namespace.txt"
  echo "--- docker compose ps ---"
  cat "$dir/compose-ps.txt"
  echo "--- state file ---"
  cat "$dir/state.json"
  echo "--- end capture ---"
}

# Mirror production: PATH with no `node` binary (server has none). Host-Node
# dependency must fail here the same way it would on the deploy host.
path_without_node() {
  local d new=""
  local IFS=':'
  for d in $PATH; do
    if [ -e "$d/node" ] || [ -L "$d/node" ]; then
      continue
    fi
    if [ -n "$new" ]; then
      new="$new:$d"
    else
      new="$d"
    fi
  done
  printf '%s' "$new"
}

# Like the GHA fingerprint step, then VPS `git checkout --force "$DEPLOY_SHA"`.
load_fingerprints() {
  local out identity executable
  out="$(node --import tsx scripts/ponder-deploy-fingerprints.ts)"
  identity="$(printf '%s\n' "$out" | sed -n 's/^identity=//p' | head -n1)"
  executable="$(printf '%s\n' "$out" | sed -n 's/^executable=//p' | head -n1)"
  : "${identity:?fingerprint identity missing}"
  : "${executable:?fingerprint executable missing}"
  export IDENTITY_DIGEST="$identity"
  export EXECUTABLE_DIGEST="$executable"
  echo "fingerprints identity=$IDENTITY_DIGEST executable=$EXECUTABLE_DIGEST"
}

run_deploy() {
  local op="$1" event="$2" sha="$3" ec=0
  echo "=== run_deploy op=$op event=$event sha=$sha ==="
  # Workflow: checkout DEPLOY_SHA in the deploy root, then compute digests on that tree.
  git checkout --force "$sha"
  test "$(git rev-parse HEAD)" = "$sha"
  load_fingerprints
  export OPERATION="$op" EVENT_NAME="$event" DEPLOY_SHA="$sha"
  set +e
  env PATH="$(path_without_node)" "$ROOT/scripts/ponder-deploy.sh"
  ec=$?
  set -e
  # On wait failure, rehearsal captures slot logs (not deploy stdout).
  if [ "$ec" -ne 0 ]; then
    for slot in blue green; do
      echo "=== rehearsal capture: docker compose logs --tail 200 ponder-${slot} ==="
      docker compose logs --tail 200 "ponder-${slot}" 2>&1 || true
    done
  fi
  return "$ec"
}

report_slot_image_size() {
  local tag="$1"
  local bytes
  bytes="$(docker image inspect "$tag" --format '{{.Size}}' 2>/dev/null || true)"
  if [ -z "$bytes" ]; then
    echo "slot_image_size tag=$tag missing"
    return 1
  fi
  local human
  human="$(awk -v b="$bytes" 'BEGIN{
    split("B KB MB GB TB", u, " ");
    s=b+0; i=1;
    while (s>=1024 && i<5) { s/=1024; i++ }
    printf "%.2f%s", s, u[i]
  }')"
  echo "slot_image_size tag=$tag bytes=$bytes human=$human"
}

echo "=== bootstrap legacy writer @ 25689e1 ==="
docker compose up -d postgres
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U ponder -d kargain_ponder >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

SCRATCH="${TMPDIR:-/tmp}/kargain-rehearsal-scratch-$$"
rm -rf "$SCRATCH"
git worktree remove --force "$SCRATCH" 2>/dev/null || true
git worktree add --detach "$SCRATCH" 25689e1d
(
  cd "$SCRATCH"
  # Current dockerignore so the legacy build context stays lean.
  cp "$ROOT/.dockerignore" .dockerignore
  printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD" >.env
  docker build -f Dockerfile.ponder -t "kargain-ponder:legacy-base" .
)
report_slot_image_size "kargain-ponder:legacy-base" | tee "$OUT/legacy-image-size.txt"

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
# Ensure we are on the PR head for deploy:local / fingerprint sources.
git checkout --force "$ORIGINAL_HEAD"
pnpm deploy:local
PONDER_RPC_URL_31337=http://127.0.0.1:8545 \
  eval "$(node --import tsx scripts/rehearsal-local-window.ts)"
: "${PONDER_START_BLOCK_31337:?PONDER_START_BLOCK_31337 unset after local window}"
: "${PONDER_GETLOGS_BLOCK_RANGE_31337:?PONDER_GETLOGS_BLOCK_RANGE_31337 unset after local window}"
export PONDER_START_BLOCK_31337 PONDER_GETLOGS_BLOCK_RANGE_31337
echo "PONDER_START_BLOCK_31337=$PONDER_START_BLOCK_31337"
echo "PONDER_GETLOGS_BLOCK_RANGE_31337=$PONDER_GETLOGS_BLOCK_RANGE_31337"
export PONDER_RPC_URL_31337=http://host.docker.internal:8545

# Slot env must satisfy the legacy image exactly as ENABLE_LOCAL expects addresses.
# No rename of PONDER_*_ADDRESS vs 25689e1 — inject from the local stack manifest.
eval "$(node --import tsx -e '
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync("deployments/31337.json", "utf8"));
const map = [
  ["PONDER_KAR_PASSPORT_ADDRESS", d.karPassport],
  ["PONDER_KAR_PRO_PASS_ADDRESS", d.karProPass],
  ["PONDER_KAR_PRO_STAKING_ADDRESS", d.karProStaking],
  ["PONDER_USDC_ADDRESS", d.usdc],
  ["PONDER_NATIVE_FEED_ADDRESS", d.nativeFeed],
  ["PONDER_TIMELOCK_ADDRESS", d.timelock],
  ["PONDER_PLATFORM_RECIPIENT_ADDRESS", d.platformRecipient],
  ["PONDER_FIXED_PRICE_CONSIGNMENT_ADDRESS", d.fixedPriceConsignment],
  ["PONDER_ASCENDING_CONSIGNMENT_ADDRESS", d.ascendingConsignment],
  ["PONDER_BRIDGE_GATEWAY_ADDRESS", d.bridgeGateway],
];
for (const [k, v] of map) {
  if (v) console.log(`export ${k}=${JSON.stringify(v)}`);
}
')"
: "${PONDER_KAR_PASSPORT_ADDRESS:?missing local stack address}"
: "${PONDER_KAR_PRO_PASS_ADDRESS:?missing local stack address}"
: "${PONDER_KAR_PRO_STAKING_ADDRESS:?missing local stack address}"
: "${PONDER_USDC_ADDRESS:?missing local stack address}"
: "${PONDER_NATIVE_FEED_ADDRESS:?missing local stack address}"
: "${PONDER_TIMELOCK_ADDRESS:?missing local stack address}"
: "${PONDER_PLATFORM_RECIPIENT_ADDRESS:?missing local stack address}"
export PONDER_KAR_PASSPORT_ADDRESS PONDER_KAR_PRO_PASS_ADDRESS PONDER_KAR_PRO_STAKING_ADDRESS
export PONDER_USDC_ADDRESS PONDER_NATIVE_FEED_ADDRESS PONDER_TIMELOCK_ADDRESS
export PONDER_PLATFORM_RECIPIENT_ADDRESS
export PONDER_FIXED_PRICE_CONSIGNMENT_ADDRESS="${PONDER_FIXED_PRICE_CONSIGNMENT_ADDRESS:-}"
export PONDER_ASCENDING_CONSIGNMENT_ADDRESS="${PONDER_ASCENDING_CONSIGNMENT_ADDRESS:-}"
export PONDER_BRIDGE_GATEWAY_ADDRESS="${PONDER_BRIDGE_GATEWAY_ADDRESS:-}"

cat >"$ROOT/$PRE_CUTOVER_REL" <<EOF
services:
  ponder:
    image: kargain-ponder:legacy-base
    pull_policy: never
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      DATABASE_URL: postgresql://ponder:\${POSTGRES_PASSWORD}@postgres:5432/kargain_ponder
      DATABASE_SCHEMA: kargain
      PONDER_ENABLE_LOCAL: "1"
      PONDER_LOCAL_ONLY: "1"
      PONDER_RPC_URL_31337: http://host.docker.internal:8545
      PONDER_RPC_URLS_31337: http://host.docker.internal:8545
      PONDER_START_BLOCK_31337: "${PONDER_START_BLOCK_31337}"
      PONDER_GETLOGS_BLOCK_RANGE_31337: "${PONDER_GETLOGS_BLOCK_RANGE_31337}"
      PONDER_KAR_PASSPORT_ADDRESS: "${PONDER_KAR_PASSPORT_ADDRESS}"
      PONDER_KAR_PRO_PASS_ADDRESS: "${PONDER_KAR_PRO_PASS_ADDRESS}"
      PONDER_KAR_PRO_STAKING_ADDRESS: "${PONDER_KAR_PRO_STAKING_ADDRESS}"
      PONDER_USDC_ADDRESS: "${PONDER_USDC_ADDRESS}"
      PONDER_NATIVE_FEED_ADDRESS: "${PONDER_NATIVE_FEED_ADDRESS}"
      PONDER_TIMELOCK_ADDRESS: "${PONDER_TIMELOCK_ADDRESS}"
      PONDER_PLATFORM_RECIPIENT_ADDRESS: "${PONDER_PLATFORM_RECIPIENT_ADDRESS}"
      PONDER_FIXED_PRICE_CONSIGNMENT_ADDRESS: "${PONDER_FIXED_PRICE_CONSIGNMENT_ADDRESS}"
      PONDER_ASCENDING_CONSIGNMENT_ADDRESS: "${PONDER_ASCENDING_CONSIGNMENT_ADDRESS}"
      PONDER_BRIDGE_GATEWAY_ADDRESS: "${PONDER_BRIDGE_GATEWAY_ADDRESS}"
    ports:
      - "127.0.0.1:42069:42069"
    networks:
      - kargain
EOF

PRE_CUTOVER_COMPOSE="docker-compose.yml:ops/rehearsal/docker-compose.rehearsal.yml:${PRE_CUTOVER_REL}"
use_compose "$PRE_CUTOVER_COMPOSE"
docker compose stop ponder ponder-blue ponder-green 2>/dev/null || true
docker compose up -d postgres ponder
printf '%s\n' '{"identity":"rehearsal-identity","executable":"exec-legacy"}' >"$PONDER_STATE_FILE"

HEAD_SHA="$ORIGINAL_HEAD"

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
rm -rf .ponder-upstream.conf
printf 'set $ponder_upstream http://ponder-blue:42069;\n' >.ponder-upstream.conf
run_deploy hold workflow_dispatch "$HEAD_SHA" | tee "$OUT/step-2/executor.txt"
capture "$OUT/step-2"
report_slot_image_size "kargain-ponder:$HEAD_SHA" | tee -a "$OUT/step-2/executor.txt" | tee "$OUT/slot-image-size.txt"

step 3 "deploy → first switch"
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
# Real second commit on a branch tip that changes the executable fingerprint / build_id.
git checkout --force -B "rehearsal-second-$ORIGINAL_HEAD" "$HEAD_SHA"
echo "// rehearsal build_id bump $(date -u +%s)" >>src/lib/ponder-writer-schema.ts
git add src/lib/ponder-writer-schema.ts
git -c user.email=rehearsal@local -c user.name=rehearsal \
  commit -m "rehearsal: bump writer schema comment for build_id"
SECOND_SHA="$(git rev-parse HEAD)"
printf '%s\n' "$SECOND_SHA" >"$OUT/second-sha.txt"
echo "second_sha=$SECOND_SHA"
run_deploy deploy workflow_dispatch "$SECOND_SHA" | tee "$OUT/step-6/executor.txt"
capture "$OUT/step-6"
grep -q "k_${SECOND_SHA}" "$OUT/step-6/pg_namespace.txt" \
  || grep -q "schema=k_${SECOND_SHA}" "$OUT/step-6/executor.txt"
# Retention drops the legacy kargain schema after the second-commit switch.
if grep -q '^kargain$' "$OUT/step-6/pg_namespace.txt"; then
  echo "step 6 expected retention to drop kargain"
  exit 1
fi
report_slot_image_size "kargain-ponder:$SECOND_SHA" | tee -a "$OUT/step-6/executor.txt" | tee "$OUT/step-6-image-size.txt"

step 7 "restart live writer without nginx reload"
# State CLI needs a checkout that still has the CLI; SECOND_SHA does.
git checkout --force "$SECOND_SHA"
LIVE_SLOT="$(node --import tsx scripts/ponder-deploy-state-cli.ts --live-slot "$PONDER_STATE_FILE" --pre-cutover 0 | tr -d '\r')"
LIVE_SLOT="${LIVE_SLOT:-blue}"
# ADR 0015 #73 step 7: nginx stays up without reload — any HTTP status (incl. 502
# while the writer restarts) counts as "HTTP back", not writer /ready 200.
START_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
docker compose restart "ponder-$LIVE_SLOT"
ok=0
for i in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:42069/ready" || true)"
  case "$code" in
    [1-5][0-9][0-9])
      ok=1
      break
      ;;
  esac
  sleep 0.25
done
END_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
ELAPSED=$((END_MS - START_MS))
echo "nginx_recovery_ms=$ELAPSED recovered=$ok http_code=${code:-none} bound_ms=10000" | tee "$OUT/step-7/executor.txt"
capture "$OUT/step-7"
test "$ok" = "1"
test "$ELAPSED" -le 10000

step 8 "not-ready pending superseded"
# Hold a third commit (new executable) → pending writer, then stop it so observe
# sees not-ready, then deploy SECOND_SHA's successor… use a fourth bump on second branch.
git checkout --force -B "rehearsal-third-$ORIGINAL_HEAD" "$SECOND_SHA"
echo "// rehearsal pending-stale bump $(date -u +%s)" >>src/lib/ponder-writer-schema.ts
git add src/lib/ponder-writer-schema.ts
git -c user.email=rehearsal@local -c user.name=rehearsal \
  commit -m "rehearsal: pending not-ready candidate"
THIRD_SHA="$(git rev-parse HEAD)"
printf '%s\n' "$THIRD_SHA" >"$OUT/third-sha.txt"
echo "third_sha=$THIRD_SHA"
mkdir -p "$OUT/step-8a"
run_deploy hold workflow_dispatch "$THIRD_SHA" | tee "$OUT/step-8a/executor.txt"
capture "$OUT/step-8a"
# Pending slot from hold evidence / state.
PENDING_SLOT="$(node --import tsx -e '
import { readFileSync } from "node:fs";
const s = JSON.parse(readFileSync(process.env.PONDER_STATE_FILE, "utf8"));
if (!s.pending?.slot) { console.error("no pending after hold"); process.exit(1); }
console.log(s.pending.slot);
')"
echo "pending_slot=$PENDING_SLOT"
docker compose stop "ponder-${PENDING_SLOT}"
# Probe kind while not answering (deploy-tools on Compose network).
PROBE_KIND="$(docker compose --profile deploy-tools run --rm --no-deps -T deploy-tools \
  scripts/ponder-ready-probe.ts --mode answered --format json \
  --url "http://ponder-${PENDING_SLOT}:42069/ready" --timeout-ms 3000 \
  | tail -n1 | python3 -c 'import json,sys; print(json.load(sys.stdin).get("kind","?"))')"
echo "probe_kind=$PROBE_KIND" | tee "$OUT/step-8/probe-kind.txt"
test "$PROBE_KIND" = "no_answer" -o "$PROBE_KIND" = "probe_failed" -o "$PROBE_KIND" = "status"
# Newer commit than the not-ready pending: bump again and deploy → supersede.
echo "// rehearsal supersede newer $(date -u +%s)" >>src/lib/ponder-writer-schema.ts
git add src/lib/ponder-writer-schema.ts
git -c user.email=rehearsal@local -c user.name=rehearsal \
  commit -m "rehearsal: supersede newer commit"
NEWER_SHA="$(git rev-parse HEAD)"
printf '%s\n' "$NEWER_SHA" >"$OUT/newer-sha.txt"
echo "newer_sha=$NEWER_SHA"
run_deploy deploy workflow_dispatch "$NEWER_SHA" | tee "$OUT/step-8/executor.txt"
capture "$OUT/step-8"
# Supersede drops the third pending schema.
if grep -q "k_${THIRD_SHA}" "$OUT/step-8/pg_namespace.txt"; then
  echo "step 8 expected supersede to drop k_${THIRD_SHA}"
  exit 1
fi
grep -q "k_${NEWER_SHA}" "$OUT/step-8/pg_namespace.txt" \
  || grep -q "schema=k_${NEWER_SHA}" "$OUT/step-8/executor.txt"

step 9 "state file removed → deploy_state_invalid"
rm -f "$PONDER_STATE_FILE"
# Expected refusal — do not dump writer logs on this named failure.
set +e
(
  export OPERATION=deploy EVENT_NAME=workflow_dispatch DEPLOY_SHA="$NEWER_SHA"
  git checkout --force "$NEWER_SHA"
  test "$(git rev-parse HEAD)" = "$NEWER_SHA"
  load_fingerprints
  env PATH="$(path_without_node)" "$ROOT/scripts/ponder-deploy.sh"
) >"$OUT/step-9/executor.txt" 2>&1
ec=$?
set -e
echo "step9_exit=$ec"
capture "$OUT/step-9"
# Keep the named refusal visible in the rehearsal log (not only the file).
grep 'deploy_state_invalid' "$OUT/step-9/executor.txt" | head -n 5
grep -q 'deploy_state_invalid' "$OUT/step-9/executor.txt"
test "$ec" -ne 0

# Prefer the latest writer image still present after retention.
if docker image inspect "kargain-ponder:$NEWER_SHA" >/dev/null 2>&1; then
  report_slot_image_size "kargain-ponder:$NEWER_SHA" | tee "$OUT/slot-image-size-final.txt"
elif docker image inspect "kargain-ponder:$HEAD_SHA" >/dev/null 2>&1; then
  report_slot_image_size "kargain-ponder:$HEAD_SHA" | tee "$OUT/slot-image-size-final.txt"
else
  echo "slot_image_size final skipped (images reclaimed)" | tee "$OUT/slot-image-size-final.txt"
fi
echo "=== rehearsal complete head=$ORIGINAL_HEAD out=$OUT ==="
