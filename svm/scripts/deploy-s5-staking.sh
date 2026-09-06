#!/usr/bin/env bash
# S5 — Upgrade kar_pro_staking + kar_pro_pass in place (ids from COMMERCIAL_ACTIVE).
# Retain deployer upgrade authority (S4–S9). Does not redeploy passport/gateway.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}
need_cmd solana
need_cmd cargo-build-sbf
need_cmd pnpm

: "${SOLANA_RPC_URL:?SOLANA_RPC_URL required}"
: "${SOLANA_DEPLOYER_PRIVATE_KEY:?SOLANA_DEPLOYER_PRIVATE_KEY required}"

RPC="$SOLANA_RPC_URL"
echo "==> S5 Devnet staking + pass upgrade in place (retain deployer UA)"
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

echo "==> build kar_pro_staking + kar_pro_pass (+ passport for prove) (--arch v3)"
(cd svm/programs/kar-pro-staking && cargo-build-sbf --arch v3)
(cd svm/programs/kar-pro-pass && cargo-build-sbf --arch v3)
(cd svm/programs/kar-passport && cargo-build-sbf --arch v3)

DEPLOY_DIR="$ROOT/svm/target/deploy"
EVIDENCE="$ROOT/deployments/svm-40168.json"
mkdir -p "$ROOT/deployments"

echo "==> upgrade kar_pro_staking + kar_pro_pass (no new program keypairs)"
pnpm exec tsx scripts/svm-upgrade-in-place.ts \
  --programs kar_pro_staking,kar_pro_pass \
  --so-dir "$DEPLOY_DIR" \
  --rpc "$RPC" \
  --deployer-keypair "$DEPLOYER_KP" \
  --evidence "$EVIDENCE"

# Also refresh passport BPF when prove needs VerifyPassport / SetStakingProgram
pnpm exec tsx scripts/svm-upgrade-in-place.ts \
  --programs kar_passport \
  --so-dir "$DEPLOY_DIR" \
  --rpc "$RPC" \
  --deployer-keypair "$DEPLOYER_KP" \
  --evidence "$EVIDENCE"

STAKING_ID="$(pnpm exec tsx -e 'import { requireSvmCommercialActive } from "./lib/web3/commercial-active.ts"; import { namespaceFromLayerZeroEid } from "./lib/web3/kargain-namespace.ts"; process.stdout.write(requireSvmCommercialActive(namespaceFromLayerZeroEid(40168)).karProStaking);')"
PASS_ID="$(pnpm exec tsx -e 'import { requireSvmCommercialActive } from "./lib/web3/commercial-active.ts"; import { namespaceFromLayerZeroEid } from "./lib/web3/kargain-namespace.ts"; process.stdout.write(requireSvmCommercialActive(namespaceFromLayerZeroEid(40168)).karProPass);')"

echo "==> pair init + pin min stake (stated testnet constant recorded in evidence)"
pnpm exec tsx scripts/svm-s5-init-and-prove.ts \
  --staking "$STAKING_ID" \
  --pass "$PASS_ID" \
  --deployer-keypair "$DEPLOYER_KP" \
  --rpc "$RPC" \
  --evidence "$EVIDENCE" \
  --work "$WORK"

echo "==> S5 upgrade + prove via svm-s5-init-and-prove.ts (no UA handoff)"
echo "    staking=$STAKING_ID"
echo "    pass=$PASS_ID"
echo "DONE (deployer retains UA)"
