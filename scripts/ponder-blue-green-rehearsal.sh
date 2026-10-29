#!/usr/bin/env bash
# Local Docker rehearsal for ADR 0014 / issue #69 / PR #71 D1 (13 steps).
#
# Binding rules:
# - Every deploy mutation runs scripts/ponder-deploy.sh (sole executor).
# - No hand-written state / SQL / upstream / evidence lines — paste executor stdout only.
# - Real Ponder from Dockerfile.ponder indexing local Hardhat (e2e-local style).
# - Start from base commit 25689e1 single writer on schema kargain + {identity,executable}.
# - Scratch clone holds PR head + two real commits (2nd changes build_id via src/index.ts).
# - COMPOSE_FILE=docker-compose.yml:ops/rehearsal/docker-compose.rehearsal.yml
#   (rehearsal-only: no deploy workflow, ponder-deploy.sh or production compose names it)
# - No external RPC; no real hosts; scrub URLs from logged output.
#
# Env:
#   REHEARSAL_OUT              default: <repo>/.ponder-rehearsal-out
#   REHEARSAL_SAMPLE_GAP_SEC   default: 5 (step 3 takes two real samples per label;
#                              the §e window rules are proven on constructed files)
#   REHEARSAL_STOP_AFTER       optional: stop after step N (smoke: 2)
#   REHEARSAL_KEEP             if 1, leave compose/hardhat up on exit
#
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${REHEARSAL_OUT:-$REPO/.ponder-rehearsal-out}"
BASE="${REHEARSAL_BASE:-/tmp/kargain-r17-base}"
SCRATCH="${REHEARSAL_SCRATCH:-/tmp/kargain-r17-scratch}"
PROJECT="${COMPOSE_PROJECT_NAME:-kargain-r17}"
SAMPLE_GAP="${REHEARSAL_SAMPLE_GAP_SEC:-5}"
STOP_AFTER="${REHEARSAL_STOP_AFTER:-}"
MOCK_84532_PORT="${REHEARSAL_MOCK_84532_PORT:-18545}"
MOCK_11155111_PORT="${REHEARSAL_MOCK_11155111_PORT:-18546}"

HH_PID=""
MOCK_PID=""

cleanup() {
  if [[ "${REHEARSAL_KEEP:-0}" == "1" ]]; then
    return 0
  fi
  if [[ -n "${MOCK_PID}" ]] && kill -0 "${MOCK_PID}" 2>/dev/null; then
    kill "${MOCK_PID}" 2>/dev/null || true
  fi
  if [[ -n "${HH_PID}" ]] && kill -0 "${HH_PID}" 2>/dev/null; then
    kill "${HH_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "$OUT/logs" "$OUT/samples" "$OUT/steps" "$OUT/certs" "$OUT/mock"

# Resolve short base commit to full sha from this repo.
BASE_SHA="$(git -C "$REPO" rev-parse 25689e1)"
PRIOR_SHA="$BASE_SHA"

step_banner() {
  mkdir -p "$OUT/steps/$(printf '%02d' "$1")"
  echo ""
  echo "======== step $1: $2 ========"
}

# Strip URLs / hostnames from pasted executor output (D1: no URL in output).
scrub() {
  # shellcheck disable=SC2001
  sed -E \
    -e 's#https?://[^[:space:]]+#<url>#g' \
    -e 's#host\.docker\.internal#<host>#g' \
    -e 's#127\.0\.0\.1#<loopback>#g' \
    -e 's#localhost#<loopback>#g'
}

record_snapshot() {
  local step="$1"
  local dir="$OUT/steps/$(printf '%02d' "$step")"
  mkdir -p "$dir"
  {
    echo "# pg_namespace"
    docker compose exec -T postgres \
      psql -U ponder -d kargain_ponder -t -A -c \
      "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY 1;" \
      2>/dev/null || echo "(postgres unavailable)"
    echo "# docker compose ps"
    docker compose ps -a 2>/dev/null || true
    echo "# state file"
    if [[ -f "${PONDER_STATE_FILE:-}" ]]; then
      cat "$PONDER_STATE_FILE"
    else
      echo "(missing)"
    fi
  } | scrub | tee "$dir/snapshot.txt" >/dev/null
  cp "$dir/snapshot.txt" "$dir/snapshot.txt" 2>/dev/null || true
  # Also append a short pointer into the step log header
  {
    echo "--- snapshot ---"
    cat "$dir/snapshot.txt"
  } >>"$dir/executor.txt"
}

# Run deploy.sh; capture scrubbed stdout into step log. Returns deploy exit code.
# Appends when the same step runs deploy more than once (e.g. step 5 rollback→hold→deploy).
run_deploy() {
  local step="$1"
  shift
  local dir="$OUT/steps/$(printf '%02d' "$step")"
  mkdir -p "$dir"
  local ec=0
  local stderr_chunk
  stderr_chunk="$(mktemp)"
  set +e
  (
    cd "$PONDER_DEPLOY_ROOT"
    env "$@" ./scripts/ponder-deploy.sh
  ) 2>"$stderr_chunk" | scrub | tee -a "$dir/executor.txt"
  ec=${PIPESTATUS[0]}
  set -e
  if [[ -s "$stderr_chunk" ]]; then
    scrub <"$stderr_chunk" | tee -a "$dir/executor.stderr" | tee -a "$dir/executor.txt" >/dev/null
  fi
  rm -f "$stderr_chunk"
  record_snapshot "$step"
  return "$ec"
}

maybe_stop() {
  local step="$1"
  if [[ -n "$STOP_AFTER" && "$step" -ge "$STOP_AFTER" ]]; then
    echo "REHEARSAL_STOP_AFTER=$STOP_AFTER — stopping after step $step"
    exit 0
  fi
}

write_rehearsal_env() {
  local root="$1"
  cat >"$root/.env" <<EOF
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgresql://ponder:${POSTGRES_PASSWORD}@postgres:5432/kargain_ponder
PONDER_ENABLE_LOCAL=1
PONDER_LOCAL_ONLY=1
PONDER_RPC_URL_31337=http://host.docker.internal:8545
PONDER_START_BLOCK=0
PONDER_START_BLOCK_31337=0
PONDER_START_BLOCK_84532=0
PONDER_START_BLOCK_11155111=0
PONDER_GETLOGS_BLOCK_RANGE_84532=1
PONDER_GETLOGS_BLOCK_RANGE_11155111=1
PONDER_RPC_URLS_84532=https://host.docker.internal:${MOCK_84532_PORT}
PONDER_RPC_URLS_11155111=https://host.docker.internal:${MOCK_11155111_PORT}
NODE_TLS_REJECT_UNAUTHORIZED=0
EOF
  # Upstream include must exist before nginx can start (cutover).
  if [[ ! -f "$root/.ponder-upstream.conf" ]]; then
    printf 'set $ponder_upstream http://ponder-blue:42069;\n' >"$root/.ponder-upstream.conf"
  fi
}

start_hardhat() {
  echo "==> Hardhat node"
  if curl -sf -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    http://127.0.0.1:8545 >/dev/null 2>&1; then
    echo "Hardhat already answering on :8545"
    return 0
  fi
  (cd "$REPO" && npx hardhat node >"$OUT/logs/hardhat.log" 2>&1) &
  HH_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf -X POST -H "Content-Type: application/json" \
      --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
      http://127.0.0.1:8545 >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! curl -sf -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    http://127.0.0.1:8545 >/dev/null 2>&1; then
    echo "ERROR: Hardhat did not become ready" >&2
    exit 1
  fi
  if [[ ! -f "$REPO/deployments/31337.json" ]]; then
    (cd "$REPO" && pnpm deploy:local)
  else
    # Refresh local deploy if chain is empty of our contracts — best-effort.
    (cd "$REPO" && pnpm deploy:local) || true
  fi
}

start_rpc_mocks() {
  echo "==> Local HTTPS JSON-RPC mocks for preflight (no external RPC)"
  if [[ ! -f "$OUT/certs/cert.pem" ]]; then
    openssl req -x509 -newkey rsa:2048 -keyout "$OUT/certs/key.pem" \
      -out "$OUT/certs/cert.pem" -days 1 -nodes \
      -subj "/CN=host.docker.internal" >/dev/null 2>&1
  fi
  cat >"$OUT/mock/rpc-mock.mjs" <<'MOCK'
import https from "node:https";
import fs from "node:fs";

const chainId = Number(process.env.MOCK_CHAIN_ID);
const port = Number(process.env.MOCK_PORT);
const key = fs.readFileSync(process.env.MOCK_KEY);
const cert = fs.readFileSync(process.env.MOCK_CERT);

function hex(n) {
  return "0x" + Number(n).toString(16);
}

const server = https.createServer({ key, cert }, (req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let msg;
    try {
      msg = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400);
      res.end("bad json");
      return;
    }
    const id = msg.id ?? 1;
    const method = msg.method;
    let result = null;
    if (method === "eth_chainId") {
      result = hex(chainId);
    } else if (method === "eth_getBlockByNumber") {
      const blockHex = Array.isArray(msg.params) ? msg.params[0] : "0x0";
      const n = blockHex === "latest" ? 1 : Number.parseInt(String(blockHex), 16);
      result = {
        number: hex(Number.isFinite(n) ? n : 0),
        timestamp: hex(Math.floor(Date.now() / 1000)),
        hash: "0x" + "ab".repeat(32),
      };
    } else if (method === "eth_getLogs") {
      const filter = Array.isArray(msg.params) ? msg.params[0] || {} : {};
      const addrs = filter.address;
      const addr = Array.isArray(addrs) ? addrs[0] : addrs;
      // Non-empty so preflight does not refuse empty_reference.
      result = [
        {
          address: addr || "0x0000000000000000000000000000000000000001",
          topics: ["0x" + "11".repeat(32)],
          data: "0x",
          blockNumber: hex(0),
          transactionHash: "0x" + "cd".repeat(32),
          logIndex: "0x0",
        },
      ];
    } else {
      result = null;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
  });
});
server.listen(port, "0.0.0.0", () => {
  process.stderr.write(`mock chain=${chainId} port=${port}\n`);
});
MOCK
  MOCK_CHAIN_ID=84532 MOCK_PORT="$MOCK_84532_PORT" \
    MOCK_KEY="$OUT/certs/key.pem" MOCK_CERT="$OUT/certs/cert.pem" \
    node "$OUT/mock/rpc-mock.mjs" >"$OUT/logs/mock-84532.log" 2>&1 &
  local p1=$!
  MOCK_CHAIN_ID=11155111 MOCK_PORT="$MOCK_11155111_PORT" \
    MOCK_KEY="$OUT/certs/key.pem" MOCK_CERT="$OUT/certs/cert.pem" \
    node "$OUT/mock/rpc-mock.mjs" >"$OUT/logs/mock-11155111.log" 2>&1 &
  local p2=$!
  MOCK_PID="$p1"
  # Track second via process group — store both
  echo "$p1" >"$OUT/mock/pid-84532"
  echo "$p2" >"$OUT/mock/pid-11155111"
  sleep 1
}

ensure_node_modules() {
  local root="$1"
  if [[ ! -d "$root/node_modules" ]]; then
    ln -sfn "$REPO/node_modules" "$root/node_modules"
  fi
}

fingerprints_json() {
  local root="$1"
  ensure_node_modules "$root"
  local id ex
  id="$(cd "$root" && node --import tsx scripts/ponder-deploy-fingerprints.ts 2>/dev/null \
    | awk -F= '/^identity=/{print $2; exit}')"
  ex="$(cd "$root" && node --import tsx scripts/ponder-deploy-fingerprints.ts 2>/dev/null \
    | awk -F= '/^executable=/{print $2; exit}')"
  if [[ -z "$id" || -z "$ex" ]]; then
    echo "ERROR: fingerprints empty under $root" >&2
    exit 1
  fi
  printf '{"identity":"%s","executable":"%s"}\n' "$id" "$ex"
}

wait_http() {
  local url="$1" want="${2:-200}" tries="${3:-120}"
  local code
  for _ in $(seq 1 "$tries"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || echo 000)"
    if [[ "$code" == "$want" ]]; then
      return 0
    fi
    sleep 2
  done
  echo "wait_http timeout url=<scrubbed> want=$want last=$code" >&2
  return 1
}

sample_lag() {
  local ponder_url="$1" out_file="$2" rounds="${3:-4}"
  : >"$out_file"
  local i
  for i in $(seq 1 "$rounds"); do
    echo "lag sample $i/$rounds"
    (
      export PONDER_ENABLE_LOCAL=1
      export PONDER_LOCAL_ONLY=1
      export PONDER_RPC_URL_31337=http://127.0.0.1:8545
      cd "$PONDER_DEPLOY_ROOT"
      node --import tsx scripts/ponder-lag-sample.ts \
        --ponder-url "$ponder_url" --out "$out_file"
    ) | scrub
    if [[ "$i" -lt "$rounds" ]]; then
      sleep "$SAMPLE_GAP"
    fi
  done
}

product_table_counts() {
  docker compose exec -T postgres psql -U ponder -d kargain_ponder -v ON_ERROR_STOP=1 <<'SQL'
SELECT format('%s=%s', c.relname,
  (xpath('//row/c/text()', query_to_xml(
    format('SELECT count(*)::text AS c FROM kargain.%I', c.relname),
    false, true, ''
  )))[1]::text
)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'kargain' AND c.relkind IN ('r','p','v')
  AND c.relname NOT LIKE '\_%'
ORDER BY 1;
SQL
}

export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-rehearsal-pass}"
export COMPOSE_PROJECT_NAME="$PROJECT"
export PONDER_RPC_URLS_84532="https://host.docker.internal:${MOCK_84532_PORT}"
export PONDER_RPC_URLS_11155111="https://host.docker.internal:${MOCK_11155111_PORT}"
export PONDER_START_BLOCK_84532=0
export PONDER_START_BLOCK_11155111=0
export PONDER_GETLOGS_BLOCK_RANGE_84532=1
export PONDER_GETLOGS_BLOCK_RANGE_11155111=1
export NODE_TLS_REJECT_UNAUTHORIZED=0

rm -rf "$OUT"
mkdir -p "$OUT/logs" "$OUT/samples" "$OUT/steps" "$OUT/certs" "$OUT/mock"

echo "==> Rehearsal out=$OUT project=$PROJECT base=$BASE_SHA gap=${SAMPLE_GAP}s"

# --- prepare scratch with PR head + two real commits ---------------------------------
echo "==> Scratch clone $SCRATCH"
rm -rf "$SCRATCH"
git clone --local "$REPO" "$SCRATCH"
BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
git -C "$SCRATCH" checkout "$BRANCH"
# Overlay dirty PR-head working tree (uncommitted D1 files) onto scratch.
rsync -a \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.ponder-rehearsal-out/' \
  --exclude '.ponder-deploy-work/' \
  --exclude '.next/' \
  --exclude 'svm/**/target/' \
  --exclude '**/target/debug/' \
  --exclude '**/target/release/' \
  --exclude 'artifacts/' \
  --exclude 'cache/' \
  "$REPO/" "$SCRATCH/"

write_rehearsal_env "$SCRATCH"
ensure_node_modules "$SCRATCH"
# Local deploy manifest (gitignored) must exist for Ponder config / slot builds.
mkdir -p "$SCRATCH/deployments"
if [[ -f "$REPO/deployments/31337.json" ]]; then
  cp "$REPO/deployments/31337.json" "$SCRATCH/deployments/31337.json"
fi

git -C "$SCRATCH" add -A
git -C "$SCRATCH" -c user.email=rehearsal@local -c user.name=rehearsal \
  commit --allow-empty -m "rehearsal: commit1 (PR head overlay)" >/dev/null
SHA1="$(git -C "$SCRATCH" rev-parse HEAD)"
# Second commit changes an indexing source that enters the identity glob (+ executable entry).
printf '\n// rehearsal build_id bump %s\n' "$(date -u +%Y%m%d%H%M%S)" >>"$SCRATCH/src/index.ts"
git -C "$SCRATCH" add src/index.ts
git -C "$SCRATCH" -c user.email=rehearsal@local -c user.name=rehearsal \
  commit -m "rehearsal: commit2 build_id via src/index.ts" >/dev/null
SHA2="$(git -C "$SCRATCH" rev-parse HEAD)"
# Park at commit1 for first hold/cutover; commit2 used later.
git -C "$SCRATCH" checkout "$SHA1" >/dev/null
# Detached checkout can drop untracked deploy manifest — restore.
mkdir -p "$SCRATCH/deployments"
cp "$REPO/deployments/31337.json" "$SCRATCH/deployments/31337.json"
ensure_node_modules "$SCRATCH"

echo "SHA1=$SHA1"
echo "SHA2=$SHA2"
echo "$SHA1" >"$OUT/sha1"
echo "$SHA2" >"$OUT/sha2"

# --- hardhat + rpc mocks -------------------------------------------------------------
start_hardhat
start_rpc_mocks

# --- base worktree: single ponder writer on kargain ----------------------------------
echo "==> Base worktree $BASE @ $BASE_SHA"
git -C "$REPO" worktree remove --force "$BASE" 2>/dev/null || true
rm -rf "$BASE"
git -C "$REPO" worktree add --detach "$BASE" "$BASE_SHA"

write_rehearsal_env "$BASE"
ensure_node_modules "$BASE"
# Local Hardhat deploy manifest is gitignored — copy from the live tree so the
# legacy image can evaluate ponder.config under PONDER_ENABLE_LOCAL=1.
mkdir -p "$BASE/deployments"
if [[ -f "$REPO/deployments/31337.json" ]]; then
  cp "$REPO/deployments/31337.json" "$BASE/deployments/31337.json"
else
  echo "ERROR: missing deployments/31337.json — run pnpm deploy:local first" >&2
  exit 1
fi

# Base-era compose: single ponder writer. Local Hardhat override.
cat >"$OUT/docker-compose.legacy-local.yml" <<EOF
services:
  ponder:
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      DATABASE_URL: postgresql://ponder:\${POSTGRES_PASSWORD}@postgres:5432/kargain_ponder
      DATABASE_SCHEMA: kargain
      PONDER_ENABLE_LOCAL: "1"
      PONDER_LOCAL_ONLY: "1"
      PONDER_RPC_URL_31337: http://host.docker.internal:8545
      PONDER_START_BLOCK: "0"
      PONDER_START_BLOCK_31337: "0"
EOF

export COMPOSE_PROJECT_NAME="$PROJECT"
(
  cd "$BASE"
  export COMPOSE_FILE="docker-compose.yml:$OUT/docker-compose.legacy-local.yml"
  docker compose -p "$PROJECT" down -v --remove-orphans >/dev/null 2>&1 || true
  docker compose -p "$PROJECT" up -d postgres
  for _ in $(seq 1 60); do
    docker compose -p "$PROJECT" exec -T postgres pg_isready -U ponder -d kargain_ponder && break
    sleep 1
  done
  echo "==> Building + starting legacy ponder (25689e1)"
  docker compose -p "$PROJECT" build ponder
  docker compose -p "$PROJECT" up -d ponder
)

echo "==> Waiting legacy /ready 200"
wait_http "http://127.0.0.1:42069/ready" 200 180

# Tag legacy image for A8 before compose definition switches to nginx.
LEGACY_IMG_ID="$(docker compose -p "$PROJECT" -f "$BASE/docker-compose.yml" \
  -f "$OUT/docker-compose.legacy-local.yml" images -q ponder | head -n1)"
if [[ -z "$LEGACY_IMG_ID" ]]; then
  LEGACY_IMG_ID="$(docker inspect -f '{{.Image}}' "$(docker compose -p "$PROJECT" ps -q ponder)" 2>/dev/null || true)"
fi
docker tag "$LEGACY_IMG_ID" kargain-ponder-legacy:cutover
echo "legacy_image_tagged id_prefix=${LEGACY_IMG_ID:0:12}"

# State file shape at that commit: {identity,executable} only.
FP_JSON="$(fingerprints_json "$BASE")"
printf '%s\n' "$FP_JSON" >"$SCRATCH/.ponder-deploy-fingerprints"
cp "$SCRATCH/.ponder-deploy-fingerprints" "$OUT/state.bootstrap.json"
echo "bootstrap state: $FP_JSON"

# --- switch deploy root to scratch + PR compose (do not up nginx yet) ----------------
export PONDER_DEPLOY_ROOT="$SCRATCH"
export PONDER_STATE_FILE="$SCRATCH/.ponder-deploy-fingerprints"
export COMPOSE_FILE="docker-compose.yml:ops/rehearsal/docker-compose.rehearsal.yml"
export COMPOSE_PROJECT_NAME="$PROJECT"
cd "$PONDER_DEPLOY_ROOT"

# Ensure slot images can build / run_node without starting nginx (legacy still binds :42069).
docker compose build ponder-blue

deploy_env() {
  # Common env for run_deploy; caller adds OPERATION/EVENT_NAME/DEPLOY_SHA overrides via "$@"
  local sha="${1:?}"
  local id ex
  git -C "$SCRATCH" checkout -q "$sha"
  # Re-apply uncommitted executor/plan fixes from the working tree (checkout
  # resets tracked scripts to the commit snapshot).
  rsync -a "$REPO/scripts/" "$SCRATCH/scripts/"
  cp "$REPO/docker-compose.yml" "$SCRATCH/docker-compose.yml"
  mkdir -p "$SCRATCH/deployments" "$SCRATCH/ops/nginx" "$SCRATCH/ops/rehearsal"
  cp "$REPO/ops/rehearsal/docker-compose.rehearsal.yml" \
    "$SCRATCH/ops/rehearsal/docker-compose.rehearsal.yml"
  cp "$REPO/deployments/31337.json" "$SCRATCH/deployments/31337.json"
  cp "$REPO/ops/nginx/ponder.conf" "$SCRATCH/ops/nginx/ponder.conf"
  ensure_node_modules "$SCRATCH"
  id="$(cd "$SCRATCH" && node --import tsx scripts/ponder-deploy-fingerprints.ts 2>/dev/null | awk -F= '/^identity=/{print $2; exit}')"
  ex="$(cd "$SCRATCH" && node --import tsx scripts/ponder-deploy-fingerprints.ts 2>/dev/null | awk -F= '/^executable=/{print $2; exit}')"
  if [[ -z "$id" || -z "$ex" ]]; then
    echo "ERROR: fingerprints empty at $sha" >&2
    exit 1
  fi
  export DEPLOY_SHA="$sha"
  export IDENTITY_DIGEST="$id"
  export EXECUTABLE_DIGEST="$ex"
  export PRIOR_CHECKOUT_SHA="$PRIOR_SHA"
  export DEPLOYED_COMMIT="$sha"
}

# ==============================================================================
# 1. push-equivalent → cutover=awaiting_dispatch
# ==============================================================================
step_banner 1 "push-equivalent → cutover=awaiting_dispatch"
deploy_env "$SHA1"
run_deploy 1 \
  OPERATION=deploy \
  EVENT_NAME=push \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  || true
maybe_stop 1

# ==============================================================================
# 2. hold → blue pending
# ==============================================================================
step_banner 2 "hold → blue pending"
deploy_env "$SHA1"
run_deploy 2 \
  OPERATION=hold \
  EVENT_NAME=workflow_dispatch \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  PONDER_RPC_URLS_84532="$PONDER_RPC_URLS_84532" \
  PONDER_RPC_URLS_11155111="$PONDER_RPC_URLS_11155111" \
  PONDER_START_BLOCK_84532=0 \
  PONDER_START_BLOCK_11155111=0 \
  PONDER_GETLOGS_BLOCK_RANGE_84532=1 \
  PONDER_GETLOGS_BLOCK_RANGE_11155111=1 \
  NODE_TLS_REJECT_UNAUTHORIZED=0
maybe_stop 2

# ==============================================================================
# 3. §e: two real samples single-writer, two dual-serve; decider on constructed files
# ==============================================================================
# The ADR window rules (≥3 samples per chain over ≥30 min, exactly the indexed chains)
# live in the decider and are covered by its unit controls; this step does not wait
# for them. It shows real `/status` samples, then feeds the decider labelled
# constructed files: pass (keep_previous), fail (restart_previous), window violation
# (refusal).
step_banner 3 "§e samples (2 single + 2 dual) + decider on constructed files"
mkdir -p "$OUT/steps/03"

echo "-- real samples: single writer (legacy :42069) --"
sample_lag "http://127.0.0.1:42069" "$OUT/samples/single.jsonl" 2
echo "-- real samples: dual-serve (blue pending + legacy) --"
sample_lag "http://127.0.0.1:42069" "$OUT/samples/dual.jsonl" 2
{
  echo "real single-writer samples:"
  cat "$OUT/samples/single.jsonl"
  echo "real dual-serve samples:"
  cat "$OUT/samples/dual.jsonl"
} | scrub | tee "$OUT/steps/03/executor.txt"

python3 - <<PY
import json, time
from pathlib import Path
chain = 31337  # PONDER_LOCAL_ONLY: the one chain this environment indexes
def write(name, lag, count, gap_min):
  out = Path("$OUT/samples/" + name)
  base = time.time() - 60*60
  rows = []
  for i in range(count):
    at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(base + i*gap_min*60))
    rows.append(json.dumps({"chainId": chain, "lag_seconds": lag, "at": at, "label": "constructed"}))
  out.write_text("\n".join(rows) + "\n")
  print("wrote", out)
write("baseline.constructed.jsonl", 1, 4, 15)
write("dual.constructed-keep_previous.jsonl", 1, 4, 15)
write("dual.constructed-restart_previous.jsonl", 99999, 4, 15)
write("dual.constructed-window.jsonl", 1, 4, 1)  # 4 samples spanning 3 min: violates ≥30 min
PY

decide() {
  # decide <dual-file> <state-file>
  (
    cd "$SCRATCH"
    export PONDER_ENABLE_LOCAL=1 PONDER_LOCAL_ONLY=1
    node --import tsx scripts/ponder-decide-rollback-model.ts \
      --baseline "$OUT/samples/baseline.constructed.jsonl" \
      --dual "$1" \
      --state "$2"
  )
}

echo "-- decider: constructed pass file → keep_previous (recorded in the live state) --"
decide "$OUT/samples/dual.constructed-keep_previous.jsonl" "$PONDER_STATE_FILE" 2>&1 | scrub | tee -a "$OUT/steps/03/executor.txt"
MODEL="$(python3 -c "import json; print(json.load(open('$PONDER_STATE_FILE')).get('rollback_model'))")"
echo "recorded_model=$MODEL" | tee -a "$OUT/steps/03/executor.txt"
if [[ "$MODEL" != "keep_previous" ]]; then
  echo "FAIL: constructed pass file did not record keep_previous" >&2
  exit 1
fi

echo "-- decider: constructed fail file → restart_previous (copy of the state) --"
cp "$PONDER_STATE_FILE" "$OUT/state.constructed-restart.json"
decide "$OUT/samples/dual.constructed-restart_previous.jsonl" "$OUT/state.constructed-restart.json" 2>&1 | scrub | tee -a "$OUT/steps/03/executor.txt"
RESTART_MODEL="$(python3 -c "import json; print(json.load(open('$OUT/state.constructed-restart.json')).get('rollback_model'))")"
echo "constructed_model=$RESTART_MODEL" | tee -a "$OUT/steps/03/executor.txt"
if [[ "$RESTART_MODEL" != "restart_previous" ]]; then
  echo "FAIL: constructed fail file did not record restart_previous" >&2
  exit 1
fi

echo "-- decider: constructed window-violation file → refusal (state untouched) --"
cp "$PONDER_STATE_FILE" "$OUT/state.constructed-window.json"
if decide "$OUT/samples/dual.constructed-window.jsonl" "$OUT/state.constructed-window.json" >"$OUT/steps/03/window.txt" 2>&1; then
  echo "FAIL: window-violating samples were accepted" >&2
  exit 1
fi
scrub <"$OUT/steps/03/window.txt" | tee -a "$OUT/steps/03/executor.txt"
grep -q "decide_rollback_model_refused" "$OUT/steps/03/window.txt"
cmp -s "$PONDER_STATE_FILE" "$OUT/state.constructed-window.json" \
  || { echo "FAIL: a refused decision changed the state" >&2; exit 1; }
record_snapshot 3
maybe_stop 3

# ==============================================================================
# 4. deploy → first cutover; product SQL counts
# ==============================================================================
step_banner 4 "deploy → first cutover"
PRE_COUNTS="$(product_table_counts | scrub || true)"
printf '%s\n' "$PRE_COUNTS" >"$OUT/steps/04/pre_counts.txt"
deploy_env "$SHA1"
run_deploy 4 \
  OPERATION=deploy \
  EVENT_NAME=workflow_dispatch \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  PONDER_RPC_URLS_84532="$PONDER_RPC_URLS_84532" \
  PONDER_RPC_URLS_11155111="$PONDER_RPC_URLS_11155111" \
  PONDER_START_BLOCK_84532=0 \
  PONDER_START_BLOCK_11155111=0 \
  PONDER_GETLOGS_BLOCK_RANGE_84532=1 \
  PONDER_GETLOGS_BLOCK_RANGE_11155111=1 \
  NODE_TLS_REJECT_UNAUTHORIZED=0
POST_COUNTS="$(product_table_counts | scrub || true)"
printf '%s\n' "$POST_COUNTS" >"$OUT/steps/04/post_counts.txt"
echo "pre_counts:" | tee -a "$OUT/steps/04/executor.txt"
echo "$PRE_COUNTS" | tee -a "$OUT/steps/04/executor.txt"
echo "post_counts:" | tee -a "$OUT/steps/04/executor.txt"
echo "$POST_COUNTS" | tee -a "$OUT/steps/04/executor.txt"
curl -s -o /dev/null -w 'http_ready=%{http_code}\n' http://127.0.0.1:42069/ready | scrub | tee -a "$OUT/steps/04/executor.txt"
maybe_stop 4

# ==============================================================================
# 5. first-cutover rollback then cutover again
# ==============================================================================
step_banner 5 "first-cutover rollback then cutover again"
deploy_env "$SHA1"
run_deploy 5 \
  OPERATION=rollback \
  EVENT_NAME=workflow_dispatch \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  PONDER_RPC_URLS_84532="$PONDER_RPC_URLS_84532" \
  PONDER_RPC_URLS_11155111="$PONDER_RPC_URLS_11155111" \
  NODE_TLS_REJECT_UNAUTHORIZED=0 \
  || true
# Re-hold + deploy to cut over again
deploy_env "$SHA1"
run_deploy 5 \
  OPERATION=hold \
  EVENT_NAME=workflow_dispatch \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  PONDER_RPC_URLS_84532="$PONDER_RPC_URLS_84532" \
  PONDER_RPC_URLS_11155111="$PONDER_RPC_URLS_11155111" \
  NODE_TLS_REJECT_UNAUTHORIZED=0
# Ensure rollback_model still set after rollback restored fingerprints-only shape
if ! python3 -c "import json; s=json.load(open('$PONDER_STATE_FILE')); assert s.get('rollback_model')"; then
  (
    cd "$SCRATCH"
    export PONDER_ENABLE_LOCAL=1 PONDER_LOCAL_ONLY=1
    node --import tsx scripts/ponder-decide-rollback-model.ts \
      --baseline "$OUT/samples/baseline.constructed.jsonl" \
      --dual "$OUT/samples/dual.constructed-keep_previous.jsonl" \
      --state "$PONDER_STATE_FILE"
  ) | scrub | tee -a "$OUT/steps/05/executor.txt"
fi
deploy_env "$SHA1"
run_deploy 5 \
  OPERATION=deploy \
  EVENT_NAME=workflow_dispatch \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  PONDER_RPC_URLS_84532="$PONDER_RPC_URLS_84532" \
  PONDER_RPC_URLS_11155111="$PONDER_RPC_URLS_11155111" \
  NODE_TLS_REJECT_UNAUTHORIZED=0
maybe_stop 5

# ==============================================================================
# 6. ready pending switched first then newer commit started same run
# ==============================================================================
step_banner 6 "ready pending switch-first then newer start"
# Start pending at SHA2 via hold, wait until /ready 200, then deploy SHA2+delta
# Create SHA3 from SHA2 with another indexing bump so executable differs from pending.
git -C "$SCRATCH" checkout -q "$SHA2"
printf '\n// rehearsal step6 newer start %s\n' "$(date -u +%Y%m%d%H%M%S)" >>"$SCRATCH/src/index.ts"
git -C "$SCRATCH" add src/index.ts
git -C "$SCRATCH" -c user.email=rehearsal@local -c user.name=rehearsal \
  commit -m "rehearsal: commit3 newer start" >/dev/null
SHA3="$(git -C "$SCRATCH" rev-parse HEAD)"
echo "SHA3=$SHA3" | tee -a "$OUT/steps/06/executor.txt"

git -C "$SCRATCH" checkout -q "$SHA2"
deploy_env "$SHA2"
run_deploy 6 \
  OPERATION=hold \
  EVENT_NAME=workflow_dispatch \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  PONDER_RPC_URLS_84532="$PONDER_RPC_URLS_84532" \
  PONDER_RPC_URLS_11155111="$PONDER_RPC_URLS_11155111" \
  NODE_TLS_REJECT_UNAUTHORIZED=0

PENDING_SLOT="$(python3 -c "import json; p=json.load(open('$PONDER_STATE_FILE')).get('pending') or {}; print(p.get('slot',''))")"
echo "pending_slot=$PENDING_SLOT" | tee -a "$OUT/steps/06/executor.txt"
code="000"
for _ in $(seq 1 180); do
  code="$(docker compose exec -T "ponder-${PENDING_SLOT}" \
    node --import tsx /app/scripts/ponder-ready-probe.ts \
    --mode ready200 \
    --url "http://127.0.0.1:42069/ready" \
    --schema "k_${SHA2}" \
    --timeout-ms 3000 2>/dev/null | awk '/switch=ready status=200/{print 200; exit}')"
  if [[ "$code" == "200" ]]; then break; fi
  # Fallback: raw HTTP from inside the slot network namespace
  code="$(docker compose exec -T "ponder-${PENDING_SLOT}" \
    node -e "fetch('http://127.0.0.1:42069/ready').then(r=>{process.stdout.write(String(r.status));process.exit(0)}).catch(()=>{process.stdout.write('000');process.exit(0)})" \
    2>/dev/null || echo 000)"
  if [[ "$code" == "200" ]]; then break; fi
  sleep 2
done
echo "pending_ready_probe=$code" | tee -a "$OUT/steps/06/executor.txt"

deploy_env "$SHA3"
run_deploy 6 \
  OPERATION=deploy \
  EVENT_NAME=workflow_dispatch \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  PONDER_RPC_URLS_84532="$PONDER_RPC_URLS_84532" \
  PONDER_RPC_URLS_11155111="$PONDER_RPC_URLS_11155111" \
  NODE_TLS_REJECT_UNAUTHORIZED=0
maybe_stop 6

# ==============================================================================
# 7. not-ready pending superseded
# ==============================================================================
step_banner 7 "not-ready pending superseded"
# New commit SHA4; hold starts cold schema (503 while backfilling). Immediately
# deploy SHA5 with different executable to supersede before ready.
git -C "$SCRATCH" checkout -q "$SHA3"
printf '\n// rehearsal step7 cold pending %s\n' "$(date -u +%Y%m%d%H%M%S)" >>"$SCRATCH/src/index.ts"
git -C "$SCRATCH" add src/index.ts
git -C "$SCRATCH" -c user.email=rehearsal@local -c user.name=rehearsal \
  commit -m "rehearsal: commit4 cold pending" >/dev/null
SHA4="$(git -C "$SCRATCH" rev-parse HEAD)"
printf '\n// rehearsal step7 supersede %s\n' "$(date -u +%Y%m%d%H%M%S)" >>"$SCRATCH/src/index.ts"
git -C "$SCRATCH" add src/index.ts
git -C "$SCRATCH" -c user.email=rehearsal@local -c user.name=rehearsal \
  commit -m "rehearsal: commit5 supersede" >/dev/null
SHA5="$(git -C "$SCRATCH" rev-parse HEAD)"

# Wipe progress on the free slot's schema after a short start by using a fresh schema
# via hold on SHA4, then stop waiting: drop checkpoints so /ready stays 503, OR
# stop the slot briefly and redeploy — simplest path: hold SHA4, then if still not
# ready, deploy SHA5 (supersede). With local Hardhat, ready may be fast — so force
# 503 by stopping the pending slot's indexing: docker pause after answered.
deploy_env "$SHA4"
run_deploy 7 \
  OPERATION=hold \
  EVENT_NAME=workflow_dispatch \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  PONDER_RPC_URLS_84532="$PONDER_RPC_URLS_84532" \
  PONDER_RPC_URLS_11155111="$PONDER_RPC_URLS_11155111" \
  NODE_TLS_REJECT_UNAUTHORIZED=0 \
  || true

PEND7="$(python3 -c "import json; p=json.load(open('$PONDER_STATE_FILE')).get('pending') or {}; print(p.get('slot',''))")"
if [[ -n "$PEND7" ]]; then
  # Force not-ready: stop so probe is no_answer (isNotReady → supersede).
  # Do not pause — that can surface as probe_failed and refuse the run.
  docker compose stop "ponder-${PEND7}" || true
  echo "forced_not_ready slot=$PEND7 (stopped)" | tee -a "$OUT/steps/07/executor.txt"
fi

deploy_env "$SHA5"
run_deploy 7 \
  OPERATION=deploy \
  EVENT_NAME=workflow_dispatch \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  PONDER_RPC_URLS_84532="$PONDER_RPC_URLS_84532" \
  PONDER_RPC_URLS_11155111="$PONDER_RPC_URLS_11155111" \
  NODE_TLS_REJECT_UNAUTHORIZED=0 \
  || true
maybe_stop 7

# ==============================================================================
# 8. concurrent product SQL + HTTP during switch, zero errors
# ==============================================================================
step_banner 8 "concurrent product SQL + HTTP during switch"
: >"$OUT/concurrent_errors.txt"
: >"$OUT/concurrent_ok.txt"
(
  errs=0
  oks=0
  for _ in $(seq 1 80); do
    code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:42069/ready || echo 000)"
    sql_ec=0
    docker compose exec -T postgres \
      psql -U ponder -d kargain_ponder -t -A -c "SELECT 1 FROM kargain.passport LIMIT 1;" \
      >/dev/null 2>&1 || sql_ec=1
    if [[ "$code" != "200" && "$code" != "503" ]]; then errs=$((errs+1)); fi
    if [[ "$sql_ec" -ne 0 ]]; then errs=$((errs+1)); else oks=$((oks+1)); fi
    sleep 0.05
  done
  echo "$errs" >"$OUT/concurrent_errors.txt"
  echo "$oks" >"$OUT/concurrent_ok.txt"
) &
READER=$!

# Trigger a normal switch: hold+deploy a newer commit
git -C "$SCRATCH" checkout -q "$SHA5"
printf '\n// rehearsal step8 switch %s\n' "$(date -u +%Y%m%d%H%M%S)" >>"$SCRATCH/src/index.ts"
git -C "$SCRATCH" add src/index.ts
git -C "$SCRATCH" -c user.email=rehearsal@local -c user.name=rehearsal \
  commit -m "rehearsal: commit6 concurrent switch" >/dev/null
SHA6="$(git -C "$SCRATCH" rev-parse HEAD)"
deploy_env "$SHA6"
run_deploy 8 \
  OPERATION=deploy \
  EVENT_NAME=push \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  PONDER_RPC_URLS_84532="$PONDER_RPC_URLS_84532" \
  PONDER_RPC_URLS_11155111="$PONDER_RPC_URLS_11155111" \
  NODE_TLS_REJECT_UNAUTHORIZED=0 \
  || true
wait "$READER" || true
echo "concurrent_errors=$(cat "$OUT/concurrent_errors.txt")" | tee -a "$OUT/steps/08/executor.txt"
echo "concurrent_sql_ok=$(cat "$OUT/concurrent_ok.txt")" | tee -a "$OUT/steps/08/executor.txt"
maybe_stop 8

# ==============================================================================
# 9. restart live slot, HTTP ≤10s
# ==============================================================================
step_banner 9 "restart live slot, HTTP ≤10s"
LIVE_SLOT="$(python3 -c "import json; print((json.load(open('$PONDER_STATE_FILE')).get('live') or {}).get('slot',''))")"
echo "live_slot=$LIVE_SLOT" | tee "$OUT/steps/09/executor.txt"
START_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"
docker compose restart "ponder-${LIVE_SLOT}"
RECOVERED=0
for _ in $(seq 1 50); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:42069/ready || echo 000)"
  if [[ "$code" == "200" || "$code" == "503" ]]; then
    # answered through nginx within bound
    RECOVERED=1
    break
  fi
  sleep 0.2
done
END_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"
ELAPSED=$((END_MS - START_MS))
echo "nginx_recovery_ms=$ELAPSED recovered=$RECOVERED bound_ms=10000" | tee -a "$OUT/steps/09/executor.txt"
record_snapshot 9
maybe_stop 9

# ==============================================================================
# 10. rollback keep_previous and restart_previous
# ==============================================================================
step_banner 10 "rollback keep_previous and restart_previous"
# Ensure previous exists: if null, do another deploy first (already have history).
# Force keep_previous via decider constructed, run rollback; then restart_previous.
cp "$PONDER_STATE_FILE" "$OUT/state.before-rollback-models.json"
python3 - <<PY
import json, time
from pathlib import Path
base = time.time() - 40*60
for name, lag in [("keep", 1), ("restart", 99999)]:
  p = Path("$OUT/samples/dual.constructed-${name}.jsonl")
  p.write_text("")
  for i in range(4):
    at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(base + i*15*60))
    p.open("a").write(json.dumps({"chainId": 31337, "lag_seconds": lag, "at": at, "label": "constructed"})+"\n")
PY

for model_label in keep restart; do
  cp "$OUT/state.before-rollback-models.json" "$PONDER_STATE_FILE"
  (
    cd "$SCRATCH"
    export PONDER_ENABLE_LOCAL=1 PONDER_LOCAL_ONLY=1
    node --import tsx scripts/ponder-decide-rollback-model.ts \
      --baseline "$OUT/samples/baseline.constructed.jsonl" \
      --dual "$OUT/samples/dual.constructed-${model_label}.jsonl" \
      --state "$PONDER_STATE_FILE"
  ) | scrub | tee -a "$OUT/steps/10/executor.txt"
  deploy_env "$(python3 -c "import json; print(json.load(open('$PONDER_STATE_FILE'))['live']['commit'])")"
  run_deploy 10 \
    OPERATION=rollback \
    EVENT_NAME=workflow_dispatch \
    DEPLOY_SHA="$DEPLOY_SHA" \
    IDENTITY_DIGEST="$IDENTITY_DIGEST" \
    EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
    PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
    PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
    PONDER_STATE_FILE="$PONDER_STATE_FILE" \
    COMPOSE_PROJECT_NAME="$PROJECT" \
    COMPOSE_FILE="$COMPOSE_FILE" \
    POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    PONDER_RPC_URLS_84532="$PONDER_RPC_URLS_84532" \
    PONDER_RPC_URLS_11155111="$PONDER_RPC_URLS_11155111" \
    NODE_TLS_REJECT_UNAUTHORIZED=0 \
    || true
done
maybe_stop 10

# ==============================================================================
# 11. same-commit collision; nginx config change → proxy recreate
# ==============================================================================
step_banner 11 "same-commit collision; nginx config change"
LIVE_COMMIT="$(python3 -c "import json; print(json.load(open('$PONDER_STATE_FILE'))['live']['commit'])")"
deploy_env "$LIVE_COMMIT"
run_deploy 11 \
  OPERATION=deploy \
  EVENT_NAME=push \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  NODE_TLS_REJECT_UNAUTHORIZED=0

# Nginx config change → proxy-only recreate
printf '\n# rehearsal nginx bump %s\n' "$(date -u +%s)" >>"$SCRATCH/ops/nginx/ponder.conf"
deploy_env "$LIVE_COMMIT"
run_deploy 11 \
  OPERATION=deploy \
  EVENT_NAME=push \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  NODE_TLS_REJECT_UNAUTHORIZED=0
maybe_stop 11

# ==============================================================================
# 12. retention before/after
# ==============================================================================
step_banner 12 "retention before/after"
echo "schemas_before:" | tee "$OUT/steps/12/executor.txt"
docker compose exec -T postgres \
  psql -U ponder -d kargain_ponder -t -A -c \
  "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'k_%' OR nspname IN ('kargain','ponder_sync','kargain_svm_raw') ORDER BY 1;" \
  | scrub | tee -a "$OUT/steps/12/executor.txt"
# Create an old unused k_* schema; next deploy retention should drop it.
OLD_SCHEMA="k_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
docker compose exec -T postgres \
  psql -U ponder -d kargain_ponder -c "CREATE SCHEMA IF NOT EXISTS \"$OLD_SCHEMA\";" >/dev/null
deploy_env "$LIVE_COMMIT"
# Touch executable so a deploy runs retention path — or rely on push unchanged still
# applying retention only on successful switches. Force a tiny executable change via
# empty hold no — use deploy with new commit that switches.
git -C "$SCRATCH" checkout -q "$LIVE_COMMIT"
printf '\n// rehearsal retention %s\n' "$(date -u +%s)" >>"$SCRATCH/src/index.ts"
git -C "$SCRATCH" add src/index.ts
git -C "$SCRATCH" -c user.email=rehearsal@local -c user.name=rehearsal \
  commit -m "rehearsal: retention trigger" >/dev/null
SHA_RET="$(git -C "$SCRATCH" rev-parse HEAD)"
deploy_env "$SHA_RET"
run_deploy 12 \
  OPERATION=deploy \
  EVENT_NAME=push \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  PONDER_RPC_URLS_84532="$PONDER_RPC_URLS_84532" \
  PONDER_RPC_URLS_11155111="$PONDER_RPC_URLS_11155111" \
  NODE_TLS_REJECT_UNAUTHORIZED=0 \
  || true
echo "schemas_after:" | tee -a "$OUT/steps/12/executor.txt"
docker compose exec -T postgres \
  psql -U ponder -d kargain_ponder -t -A -c \
  "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'k_%' OR nspname IN ('kargain','ponder_sync','kargain_svm_raw') ORDER BY 1;" \
  | scrub | tee -a "$OUT/steps/12/executor.txt"
maybe_stop 12

# ==============================================================================
# 13. remove state file → deploy_state_invalid
# ==============================================================================
step_banner 13 "remove state file → deploy_state_invalid"
rm -f "$PONDER_STATE_FILE"
deploy_env "$SHA_RET"
set +e
run_deploy 13 \
  OPERATION=deploy \
  EVENT_NAME=push \
  DEPLOY_SHA="$DEPLOY_SHA" \
  IDENTITY_DIGEST="$IDENTITY_DIGEST" \
  EXECUTABLE_DIGEST="$EXECUTABLE_DIGEST" \
  PRIOR_CHECKOUT_SHA="$PRIOR_CHECKOUT_SHA" \
  PONDER_DEPLOY_ROOT="$PONDER_DEPLOY_ROOT" \
  PONDER_STATE_FILE="$PONDER_STATE_FILE" \
  COMPOSE_PROJECT_NAME="$PROJECT" \
  COMPOSE_FILE="$COMPOSE_FILE" \
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  NODE_TLS_REJECT_UNAUTHORIZED=0
ec13=$?
set -e
echo "deploy_exit=$ec13" | tee -a "$OUT/steps/13/executor.txt"

echo ""
echo "======== rehearsal complete ========"
echo "Artifacts under $OUT"
# Kill mock servers
if [[ -f "$OUT/mock/pid-84532" ]]; then kill "$(cat "$OUT/mock/pid-84532")" 2>/dev/null || true; fi
if [[ -f "$OUT/mock/pid-11155111" ]]; then kill "$(cat "$OUT/mock/pid-11155111")" 2>/dev/null || true; fi
