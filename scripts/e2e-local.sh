#!/usr/bin/env bash
# One-shot local E2E: Hardhat node → deploy → Postgres → Ponder → viem lifecycle → teardown.
#
# Usage (from repo root):
#   ./scripts/e2e-local.sh                    # full strict: chain + indexer assertions
#   KARGAIN_E2E_CHAIN_ONLY=1 ./scripts/e2e-local.sh   # chain lifecycle only (loud skip)
#
# Strict mode needs Docker Postgres: passport entity / provenance / custody UNION
# reads use `pg` + DATABASE_URL (PGlite alone cannot serve those HTTP paths).
# Sets KARGAIN_E2E_STRICT=1 so an unreachable indexer fails the suite.
#
# Requires deployments/31337.json to include fixedPriceConsignment + ascendingConsignment
# (written by `pnpm deploy:local`).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHAIN_ONLY="${KARGAIN_E2E_CHAIN_ONLY:-0}"
E2E_PG_NAME="${KARGAIN_E2E_PG_NAME:-kargain-e2e-pg}"
E2E_PG_PORT="${KARGAIN_E2E_PG_PORT:-55432}"
E2E_PG_PASSWORD="${KARGAIN_E2E_PG_PASSWORD:-e2e_local}"

NODE_PID=""
PONDER_PID=""
STARTED_E2E_PG=0

cleanup() {
  if [[ -n "${PONDER_PID}" ]] && kill -0 "${PONDER_PID}" 2>/dev/null; then
    kill "${PONDER_PID}" 2>/dev/null || true
  fi
  if [[ -n "${NODE_PID}" ]] && kill -0 "${NODE_PID}" 2>/dev/null; then
    kill "${NODE_PID}" 2>/dev/null || true
  fi
  if [[ "${STARTED_E2E_PG}" == "1" ]]; then
    docker rm -f "${E2E_PG_NAME}" >/dev/null 2>&1 || true
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
  PONDER_FIXED_PRICE_CONSIGNMENT_ADDRESS PONDER_ASCENDING_CONSIGNMENT_ADDRESS \
  PONDER_USDC_ADDRESS PONDER_NATIVE_FEED_ADDRESS
export PONDER_ENABLE_LOCAL=1
# Index only the Hardhat chain — `/ready` must not wait on a public Sepolia RPC.
export PONDER_LOCAL_ONLY=1
export PONDER_RPC_URL_31337=http://127.0.0.1:8545
export PONDER_START_BLOCK=0
export PONDER_START_BLOCK_31337=0
export PONDER_SQL_API_URL="${PONDER_SQL_API_URL:-http://localhost:42069}"
unset PONDER_DATABASE_URL DATABASE_PRIVATE_URL PONDER_PGLITE_DIR

if [[ "${CHAIN_ONLY}" == "1" ]]; then
  export KARGAIN_E2E_CHAIN_ONLY=1
  echo "==> KARGAIN_E2E_CHAIN_ONLY=1 — skipping Ponder; chain lifecycle only"
  echo "==> Running E2E lifecycle test (chain-only)…"
  pnpm test:e2e
  echo "==> E2E (chain-only) passed."
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required for strict e2e (DATABASE_URL for UNION reads)" >&2
  echo "       (Run chain-only: KARGAIN_E2E_CHAIN_ONLY=1 ./scripts/e2e-local.sh)" >&2
  exit 1
fi

echo "==> Starting ephemeral Postgres (${E2E_PG_NAME} on :${E2E_PG_PORT})…"
docker rm -f "${E2E_PG_NAME}" >/dev/null 2>&1 || true
docker run -d --name "${E2E_PG_NAME}" \
  -e POSTGRES_USER=ponder \
  -e POSTGRES_PASSWORD="${E2E_PG_PASSWORD}" \
  -e POSTGRES_DB=kargain_ponder \
  -p "127.0.0.1:${E2E_PG_PORT}:5432" \
  postgres:16-alpine >/dev/null
STARTED_E2E_PG=1

for _ in $(seq 1 60); do
  if docker exec "${E2E_PG_NAME}" pg_isready -U ponder -d kargain_ponder >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker exec "${E2E_PG_NAME}" pg_isready -U ponder -d kargain_ponder >/dev/null 2>&1; then
  echo "ERROR: Postgres did not become ready" >&2
  exit 1
fi

export DATABASE_URL="postgresql://ponder:${E2E_PG_PASSWORD}@127.0.0.1:${E2E_PG_PORT}/kargain_ponder"
# UNION owners qualify EVM tables as kargain.* (same as VPS compose).
export DATABASE_SCHEMA=kargain

echo "==> Applying empty kargain_svm_projection (UNION arm)…"
docker exec -i "${E2E_PG_NAME}" psql -U ponder -d kargain_ponder \
  < "$ROOT/src/svm-ingest/db/projection-schema.sql" >/dev/null

echo "==> Starting Ponder (Postgres)…"
pnpm ponder:dev > /tmp/kargain-e2e-ponder.log 2>&1 &
PONDER_PID=$!

echo "==> Waiting for Ponder /ready (up to 120s)…"
PONDER_READY=0
for _ in $(seq 1 120); do
  if curl -sf "${PONDER_SQL_API_URL}/ready" >/dev/null 2>&1; then
    PONDER_READY=1
    break
  fi
  sleep 1
done
if [[ "${PONDER_READY}" != "1" ]]; then
  echo "ERROR: ${PONDER_SQL_API_URL}/ready did not return 200 within 120s" >&2
  echo "       See /tmp/kargain-e2e-ponder.log" >&2
  echo "       (Run chain-only: KARGAIN_E2E_CHAIN_ONLY=1 ./scripts/e2e-local.sh)" >&2
  exit 1
fi
echo "==> Ponder ready"

export KARGAIN_E2E_STRICT=1

echo "==> Running E2E lifecycle test (strict: chain + indexer)…"
pnpm test:e2e

echo "==> E2E passed."
