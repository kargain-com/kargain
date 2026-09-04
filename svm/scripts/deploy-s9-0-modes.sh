#!/usr/bin/env bash
# S9-0 — Deploy kar_fixed_price + kar_ascending to Solana Devnet.
# Retain deployer upgrade authority (S4–S9). Does not redeploy passport/gateway/staking/pass.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

filter_cli() {
  grep -E -v -i \
    'seed phrase|Recover the intermediate|12-word|ephemeral keypair|To resume a deploy|solana-keygen recover|solana program close|=====|^[a-z]+( [a-z]+){11}$' \
    || true
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}
need_cmd solana
need_cmd solana-keygen
need_cmd cargo-build-sbf
need_cmd pnpm

: "${SOLANA_RPC_URL:?SOLANA_RPC_URL required}"
: "${SOLANA_DEPLOYER_PRIVATE_KEY:?SOLANA_DEPLOYER_PRIVATE_KEY required}"

RPC="$SOLANA_RPC_URL"
echo "==> S9-0 Devnet FixedPrice + Ascending (retain deployer UA)"
MAT="$(pnpm exec tsx scripts/svm-materialize-deployer.ts)"
DEPLOYER_PUB="$(echo "$MAT" | cut -f1)"
DEPLOYER_KP="$(echo "$MAT" | cut -f2)"
WORK="$(echo "$MAT" | cut -f3)"
cleanup() {
  if [[ -n "${WORK:-}" && -d "$WORK" ]]; then
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

echo "    deployer: $DEPLOYER_PUB"
pnpm exec tsx scripts/assert-solana-ua-matches-deployer.ts >/dev/null
echo "    upgradeAuthority: $DEPLOYER_PUB (retained S4–S9)"

echo "==> build kar_fixed_price + kar_ascending (--arch v3)"
(cd svm/programs/kar-fixed-price && cargo-build-sbf --arch v3)
(cd svm/programs/kar-ascending && cargo-build-sbf --arch v3)

deploy_one() {
  local name="$1"
  local so="svm/target/deploy/${name}.so"
  if [[ ! -f "$so" ]]; then
    echo "missing artifact: $so" >&2
    exit 1
  fi
  echo "==> deploy $name"
  solana program deploy "$so" \
    --program-id "svm/target/deploy/${name}-keypair.json" \
    --upgrade-authority "$DEPLOYER_KP" \
    --keypair "$DEPLOYER_KP" \
    -u "$RPC" 2>&1 | filter_cli
  local pid
  pid="$(solana address -k "svm/target/deploy/${name}-keypair.json")"
  echo "    programId: $pid"
  solana program show "$pid" -u "$RPC" 2>&1 | filter_cli
}

for name in kar_fixed_price kar_ascending; do
  deploy_one "$name"
done

echo "==> S9-0 deploy done."
echo "    Update deployments/svm-40168.json:"
echo "      programs.kar_fixed_price / kar_ascending → programId + deploySlot"
echo "      leave passport/gateway/staking/pass programIds; set deploySlot to true deploy slots if missing"
echo "    Then: pnpm verify:svm-authority && pnpm deploy:svm:dry-run"
echo "    Do NOT enable svm-ingest / VPS (S9-B). Cursor = min(deploySlot) over six."
echo "    Runbook: docs/ops/deploys/s9-0-devnet-modes.md"
