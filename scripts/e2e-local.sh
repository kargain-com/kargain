#!/usr/bin/env bash
# One-shot local E2E: Hardhat node → deploy → Ponder → viem lifecycle test → teardown.
#
# Usage (from repo root):
#   ./scripts/e2e-local.sh
#
# Ponder API checks are skipped when PONDER_SQL_API_URL is unreachable.

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

echo "==> Starting Hardhat node…"
npx hardhat node > /tmp/kargain-e2e-node.log 2>&1 &
NODE_PID=$!

for _ in $(seq 1 30); do
  if curl -sf -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    http://127.0.0.1:8545 >/dev/null 2>&1; then
      break
    fi
  sleep 1
done

echo "==> Deploying to localhost…"
pnpm deploy:local

eval "$(node --import tsx "$ROOT/scripts/lib/print-local-env.ts")"
export PONDER_ENABLE_LOCAL=1
export PONDER_RPC_URL_31337=http://127.0.0.1:8545
export PONDER_START_BLOCK=0
export PONDER_SQL_API_URL="${PONDER_SQL_API_URL:-http://localhost:42069}"

if command -v docker >/dev/null 2>&1 && [[ -z "${DATABASE_URL:-}" ]]; then
  echo "==> Starting Postgres for Ponder…"
  docker compose up -d postgres 2>/dev/null || true
  export DATABASE_URL="${DATABASE_URL:-postgresql://ponder:ponder@127.0.0.1:5432/kargain_ponder}"
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "==> Starting Ponder…"
  pnpm ponder:dev > /tmp/kargain-e2e-ponder.log 2>&1 &
  PONDER_PID=$!
  sleep 8
else
  echo "==> No DATABASE_URL — Ponder checks will be skipped in E2E"
fi

echo "==> Running E2E lifecycle test…"
pnpm test:e2e

echo "==> E2E passed."
