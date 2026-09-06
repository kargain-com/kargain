#!/usr/bin/env bash
# Upgrade the four pre-S7a commercial programs in place (registry program ids).
# Unit S9-B-1 path — no new program keypairs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

: "${SOLANA_RPC_URL:?SOLANA_RPC_URL required}"
: "${SOLANA_DEPLOYER_PRIVATE_KEY:?SOLANA_DEPLOYER_PRIVATE_KEY required}"

MAT="$(pnpm exec tsx scripts/svm-materialize-deployer.ts)"
DEPLOYER_KP="$(echo "$MAT" | cut -f2)"
WORK="$(echo "$MAT" | cut -f3)"
cleanup() { rm -rf "${WORK:-}"; }
trap cleanup EXIT

echo "==> build four pre-S7a programs (--arch v3)"
(cd svm/programs/kar-passport && cargo-build-sbf --arch v3)
(cd svm/programs/kar-gateway && cargo-build-sbf --arch v3)
(cd svm/programs/kar-pro-staking && cargo-build-sbf --arch v3)
(cd svm/programs/kar-pro-pass && cargo-build-sbf --arch v3)

pnpm exec tsx scripts/assert-solana-ua-matches-deployer.ts >/dev/null
pnpm exec tsx scripts/svm-upgrade-in-place.ts \
  --programs kar_passport,kar_gateway,kar_pro_staking,kar_pro_pass \
  --so-dir svm/target/deploy \
  --rpc "$SOLANA_RPC_URL" \
  --deployer-keypair "$DEPLOYER_KP" \
  --evidence deployments/svm-40168.json

echo "DONE — four programs upgraded; evidence digests refreshed; deploySlot unchanged"
