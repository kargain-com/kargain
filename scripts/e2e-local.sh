#!/usr/bin/env bash
# One-shot local E2E: Hardhat node → deploy → Ponder (PGlite) → viem lifecycle test → teardown.
#
# Usage (from repo root):
#   ./scripts/e2e-local.sh                    # full strict: chain + indexer assertions
#   KARGAIN_E2E_CHAIN_ONLY=1 ./scripts/e2e-local.sh   # chain lifecycle only (loud skip)
#
# Ponder runs on embedded PGlite in dev — Docker is NOT required. Sets
# KARGAIN_E2E_STRICT=1 so an unreachable indexer fails the suite (not a silent skip).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHAIN_ONLY="${KARGAIN_E2E_CHAIN_ONLY:-0}"
PONDER_PGLITE_DIR="$ROOT/.ponder/e2e-pglite"

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
# Partial PONDER_* address exports break ponder.config (normalizeLocal needs the
# full manifest). Ponder loads deployments/31337.json when these are unset.
unset PONDER_KAR_PASSPORT_ADDRESS PONDER_KAR_PRO_PASS_ADDRESS PONDER_KAR_PRO_STAKING_ADDRESS \
  PONDER_MARKETPLACE_ADDRESS PONDER_USDC_ADDRESS PONDER_NATIVE_FEED_ADDRESS
export PONDER_ENABLE_LOCAL=1
# Index only the Hardhat chain — `/ready` must not wait on a public Sepolia RPC.
export PONDER_LOCAL_ONLY=1
export PONDER_RPC_URL_31337=http://127.0.0.1:8545
export PONDER_START_BLOCK=0
export PONDER_START_BLOCK_31337=0
export PONDER_SQL_API_URL="${PONDER_SQL_API_URL:-http://localhost:42069}"
# Embedded PGlite: leave DATABASE_URL unset so resolvePonderDatabase() picks PGlite.
unset DATABASE_URL PONDER_DATABASE_URL DATABASE_PRIVATE_URL
export PONDER_PGLITE_DIR

if [[ "${CHAIN_ONLY}" == "1" ]]; then
  export KARGAIN_E2E_CHAIN_ONLY=1
  echo "==> KARGAIN_E2E_CHAIN_ONLY=1 — skipping Ponder; chain lifecycle only"
  echo "==> Running E2E lifecycle test (chain-only)…"
  pnpm test:e2e
  echo "==> E2E (chain-only) passed."
  exit 0
fi

echo "==> Starting Ponder (embedded PGlite)…"
rm -rf "${PONDER_PGLITE_DIR}"
pnpm ponder:dev > /tmp/kargain-e2e-ponder.log 2>&1 &
PONDER_PID=$!

echo "==> Waiting for Ponder /ready (up to 60s)…"
PONDER_READY=0
for _ in $(seq 1 60); do
  if curl -sf "${PONDER_SQL_API_URL}/ready" >/dev/null 2>&1; then
    PONDER_READY=1
    break
  fi
  sleep 1
done
if [[ "${PONDER_READY}" != "1" ]]; then
  echo "ERROR: ${PONDER_SQL_API_URL}/ready did not return 200 within 60s" >&2
  echo "       See /tmp/kargain-e2e-ponder.log" >&2
  echo "       (Run chain-only: KARGAIN_E2E_CHAIN_ONLY=1 ./scripts/e2e-local.sh)" >&2
  exit 1
fi
echo "==> Ponder ready"

export KARGAIN_E2E_STRICT=1

echo "==> Running E2E lifecycle test (strict: chain + indexer)…"
pnpm test:e2e

echo "==> E2E passed."
