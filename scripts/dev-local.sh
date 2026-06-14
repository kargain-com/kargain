#!/usr/bin/env bash
# Local dev stack: Postgres + Hardhat node + deploy + Ponder + Next.js hints.
#
# Usage (from repo root):
#   ./scripts/dev-local.sh
#
# Requires: pnpm, docker (for Postgres), Node 20+.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NODE_PID=""
PONDER_PID=""

cleanup() {
  if [[ -n "${PONDER_PID}" ]] && kill -0 "${PONDER_PID}" 2>/dev/null; then
    kill "${PONDER_PID}" 2>/dev/null || true
  fi
  if [[ -n "${NODE_PID}" ]] && kill -0 "${NODE_PID}" 2>/dev/null; then
    kill "${NODE_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "==> Starting Postgres (docker compose)…"
if command -v docker >/dev/null 2>&1; then
  docker compose up -d postgres 2>/dev/null || echo "    (postgres already running or docker unavailable — ensure DATABASE_URL is set)"
else
  echo "    docker not found — ensure DATABASE_URL points at a running Postgres"
fi

echo "==> Starting Hardhat node on :8545…"
if curl -sf -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  http://127.0.0.1:8545 >/dev/null 2>&1; then
  echo "    node already listening"
else
  npx hardhat node > /tmp/kargain-hardhat-node.log 2>&1 &
  NODE_PID=$!
  for _ in $(seq 1 30); do
    if curl -sf -X POST -H "Content-Type: application/json" \
      --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
      http://127.0.0.1:8545 >/dev/null 2>&1; then
        break
      fi
    sleep 1
  done
fi

echo "==> Deploying contracts to localhost…"
pnpm deploy:local

DEPLOY="$ROOT/deployments/31337.json"
if [[ ! -f "$DEPLOY" ]]; then
  echo "ERROR: $DEPLOY not found after deploy:local" >&2
  exit 1
fi

echo "==> Exporting env from $DEPLOY…"
eval "$(node --import tsx "$ROOT/scripts/lib/print-local-env.ts")"

export PONDER_ENABLE_LOCAL=1
export PONDER_RPC_URL_31337="${PONDER_RPC_URL_31337:-http://127.0.0.1:8545}"
export PONDER_START_BLOCK="${PONDER_START_BLOCK:-0}"
export PONDER_SQL_API_URL="${PONDER_SQL_API_URL:-http://localhost:42069}"

echo "==> Starting Ponder (background)…"
pnpm ponder:dev > /tmp/kargain-ponder.log 2>&1 &
PONDER_PID=$!
sleep 5

echo ""
echo "Local stack ready."
echo ""
echo "  Hardhat RPC:  http://127.0.0.1:8545 (chain 31337)"
echo "  Deployments:  deployments/31337.json"
echo "  Ponder API:   ${PONDER_SQL_API_URL}"
echo "  Ponder logs:  /tmp/kargain-ponder.log"
if [[ -n "${NODE_PID}" ]]; then
  echo "  Node logs:    /tmp/kargain-hardhat-node.log"
fi
echo ""
echo "Start the frontend (new terminal):"
echo ""
echo "  export NEXT_PUBLIC_ENABLE_LOCAL_CHAIN=1"
echo "  export NEXT_PUBLIC_CHAIN_ID=31337"
echo "  export NEXT_PUBLIC_RPC_BY_CHAIN='{\"31337\":\"http://127.0.0.1:8545\"}'"
echo "  # optional: source env from deployments — run: eval \"\$(node --import tsx scripts/lib/print-local-env.ts)\""
echo "  pnpm dev"
echo ""
echo "Press Ctrl+C to stop background Ponder (and Hardhat node if started here)."

wait "${PONDER_PID}"
