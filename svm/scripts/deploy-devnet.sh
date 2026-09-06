#!/usr/bin/env bash
# Solana Devnet: upgrade passport + gateway in place (ids from COMMERCIAL_ACTIVE),
# optional aux mock_staking first-time deploy. Evidence via sole write owner.
# S4–S9: SOLANA_UPGRADE_AUTHORITY must equal deployer pubkey (no handoff).
# Never logs private keys. Requires SOLANA_* in the environment.
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
need_cmd node
need_cmd pnpm

: "${SOLANA_RPC_URL:?SOLANA_RPC_URL required}"
: "${SOLANA_FORFEIT_RECIPIENT:?SOLANA_FORFEIT_RECIPIENT required}"
: "${SOLANA_LZ_ENDPOINT:?SOLANA_LZ_ENDPOINT required}"
: "${SOLANA_DEPLOYER_PRIVATE_KEY:?SOLANA_DEPLOYER_PRIVATE_KEY required}"

RPC="$SOLANA_RPC_URL"
FORFEIT="$SOLANA_FORFEIT_RECIPIENT"
ENDPOINT="$SOLANA_LZ_ENDPOINT"
GATEWAY_AUTH="${SOLANA_GATEWAY_AUTHORITY:-}"

echo "==> Devnet passport/gateway upgrade in place (registry program ids)"
echo "    rpc: $RPC"
echo "    forfeit: ${FORFEIT:0:4}…${FORFEIT: -4}"
echo "    lzEndpoint: ${ENDPOINT:0:4}…${ENDPOINT: -4}"

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
if [[ -n "$GATEWAY_AUTH" && "$GATEWAY_AUTH" != "$DEPLOYER_PUB" ]]; then
  echo "FAIL: SOLANA_GATEWAY_AUTHORITY must be empty or equal deployer pubkey (init signer)." >&2
  exit 1
fi
GATEWAY_AUTH="$DEPLOYER_PUB"
echo "    gatewayAuthority: $GATEWAY_AUTH (deployer)"
echo "    upgradeAuthority: $DEPLOYER_PUB (retained S4–S9)"

BAL="$(solana balance "$DEPLOYER_PUB" -u "$RPC" 2>/dev/null | awk '{print $1}')"
echo "    balance: ${BAL:-?} SOL"
if [[ -z "$BAL" ]]; then
  echo "FAIL: cannot read deployer balance on $RPC" >&2
  exit 1
fi

echo "==> build kar_passport + kar_gateway + mock_staking (--arch v3)"
(cd svm/programs/kar-passport && cargo-build-sbf --arch v3)
(cd svm/programs/kar-gateway && cargo-build-sbf --arch v3)
(cd svm/programs/mock-staking && cargo-build-sbf --arch v3)

DEPLOY_DIR="$ROOT/svm/target/deploy"
EVIDENCE="$ROOT/deployments/svm-40168.json"
mkdir -p "$ROOT/deployments" "$WORK/program-keys"

echo "==> upgrade kar_passport + kar_gateway (no new program keypairs)"
pnpm exec tsx scripts/svm-upgrade-in-place.ts \
  --programs kar_passport,kar_gateway \
  --so-dir "$DEPLOY_DIR" \
  --rpc "$RPC" \
  --deployer-keypair "$DEPLOYER_KP" \
  --evidence "$EVIDENCE"

PASSPORT_ID="$(pnpm exec tsx -e 'import { requireSvmCommercialActive } from "./lib/web3/commercial-active.ts"; import { namespaceFromLayerZeroEid } from "./lib/web3/kargain-namespace.ts"; process.stdout.write(requireSvmCommercialActive(namespaceFromLayerZeroEid(40168)).karPassport);')"
GATEWAY_ID="$(pnpm exec tsx -e 'import { requireSvmCommercialActive } from "./lib/web3/commercial-active.ts"; import { namespaceFromLayerZeroEid } from "./lib/web3/kargain-namespace.ts"; process.stdout.write(requireSvmCommercialActive(namespaceFromLayerZeroEid(40168)).bridgeGateway);')"

MOCK_ID=""
if [[ "${SVM_DEPLOY_MOCK_STAKING:-0}" == "1" ]]; then
  echo "==> deploy aux mock_staking (new program id — stand only; opt-in)"
  solana-keygen new --no-bip39-passphrase -o "$WORK/program-keys/mock_staking.json" --force >/dev/null
  MOCK_ID="$(solana-keygen pubkey "$WORK/program-keys/mock_staking.json")"
  set +e
  OUT="$(solana program deploy "$DEPLOY_DIR/mock_staking.so" \
    --program-id "$WORK/program-keys/mock_staking.json" \
    --upgrade-authority "$DEPLOYER_KP" \
    --keypair "$DEPLOYER_KP" \
    -u "$RPC" 2>&1)"
  RC=$?
  set -e
  echo "$OUT" | filter_cli
  if [[ "$RC" -ne 0 ]]; then
    echo "FAIL: deploy mock_staking exit $RC" >&2
    exit 1
  fi
  SLOT="$(solana slot -u "$RPC")"
  pnpm exec tsx scripts/svm-merge-devnet-evidence.ts \
    --caller deploy-devnet.sh \
    --evidence "$EVIDENCE" \
    --programs-json "{\"mock_staking\":{\"programId\":\"$MOCK_ID\",\"upgradeAuthority\":\"$DEPLOYER_PUB\",\"deploySlot\":$SLOT}}" \
    --attach-so-json "{\"mock_staking\":\"$DEPLOY_DIR/mock_staking.so\"}"
fi

echo "==> init configs (passport + gateway from registry ids)"
export SVM_X3_PASSPORT_PROGRAM="$PASSPORT_ID"
export SVM_X3_GATEWAY_PROGRAM="$GATEWAY_ID"
export SVM_X3_STAKING_PROGRAM="${MOCK_ID}"
export SVM_X3_DEPLOYER_KEYPAIR="$DEPLOYER_KP"
pnpm exec tsx scripts/svm-devnet-init.ts

echo "==> deploy PASS"
echo "    passport: $PASSPORT_ID"
echo "    gateway:  $GATEWAY_ID"
echo "    upgradeAuthority: $DEPLOYER_PUB"
echo "    evidence: $EVIDENCE"
