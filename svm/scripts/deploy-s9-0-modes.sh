#!/usr/bin/env bash
# S9-0 — Deploy/upgrade kar_fixed_price + kar_ascending on Solana Devnet.
# Uses persistent svm/target/deploy/<name>-keypair.json for first deploy;
# subsequent runs upgrade in place. Evidence via sole write owner.
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

DEPLOY_DIR="$ROOT/svm/target/deploy"
EVIDENCE="$ROOT/deployments/svm-40168.json"
mkdir -p "$ROOT/deployments"

# Prefer registry upgrade when commercial ids already committed (S9-B+).
if pnpm exec tsx -e 'import { requireSvmCommercialActive } from "./lib/web3/commercial-active.ts"; import { namespaceFromLayerZeroEid } from "./lib/web3/kargain-namespace.ts"; const s=requireSvmCommercialActive(namespaceFromLayerZeroEid(40168)); if(!s.fixedPriceConsignment||!s.ascendingConsignment) process.exit(2);' 2>/dev/null; then
  echo "==> upgrade modes from COMMERCIAL_ACTIVE program ids"
  pnpm exec tsx scripts/svm-upgrade-in-place.ts \
    --programs kar_fixed_price,kar_ascending \
    --so-dir "$DEPLOY_DIR" \
    --rpc "$RPC" \
    --deployer-keypair "$DEPLOYER_KP" \
    --evidence "$EVIDENCE"
else
  echo "==> first-time modes deploy via persistent keypairs"
  for name in kar_fixed_price kar_ascending; do
    so="$DEPLOY_DIR/${name}.so"
    kp="$DEPLOY_DIR/${name}-keypair.json"
    if [[ ! -f "$kp" ]]; then
      echo "missing persistent keypair: $kp" >&2
      exit 1
    fi
    echo "==> deploy $name"
    solana program deploy "$so" \
      --program-id "$kp" \
      --upgrade-authority "$DEPLOYER_KP" \
      --keypair "$DEPLOYER_KP" \
      -u "$RPC" 2>&1 | filter_cli
    pid="$(solana address -k "$kp")"
    echo "    programId: $pid"
    SLOT="$(solana slot -u "$RPC")"
    pnpm exec tsx scripts/svm-merge-devnet-evidence.ts \
      --caller deploy-s9-0-modes.sh \
      --evidence "$EVIDENCE" \
      --programs-json "{\"${name}\":{\"programId\":\"${pid}\",\"upgradeAuthority\":\"${DEPLOYER_PUB}\",\"deploySlot\":${SLOT}}}" \
      --attach-so-json "{\"${name}\":\"${so}\"}"
  done
fi

echo "==> S9-0 done. Evidence: $EVIDENCE"
echo "    Then: pnpm verify:svm-authority"
echo "    Runbook: docs/ops/deploys/s9-0-devnet-modes.md"
