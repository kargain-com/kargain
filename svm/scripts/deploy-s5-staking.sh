#!/usr/bin/env bash
# S5 — Deploy kar_pro_staking + kar_pro_pass to Solana Devnet.
# Retain deployer upgrade authority (S4–S8). Does not redeploy passport/gateway.
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
# SOLANA_UPGRADE_AUTHORITY: sole check via assert-solana-ua-matches-deployer.ts (do not read here)

RPC="$SOLANA_RPC_URL"
echo "==> S5 Devnet staking + pass deploy (retain deployer UA until proven)"
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
echo "    upgradeAuthority: $DEPLOYER_PUB (retained S4–S8)"

echo "==> build kar_pro_staking + kar_pro_pass (--arch v3)"
(cd svm/programs/kar-pro-staking && cargo-build-sbf --arch v3)
(cd svm/programs/kar-pro-pass && cargo-build-sbf --arch v3)
# Passport must include VerifyPassport + SetStakingProgram for proof
(cd svm/programs/kar-passport && cargo-build-sbf --arch v3)

DEPLOY_DIR="$ROOT/svm/target/deploy"
EVIDENCE="$ROOT/deployments/svm-40168.json"
mkdir -p "$ROOT/deployments" "$WORK/program-keys"

deploy_one() {
  local name="$1"
  local so="$DEPLOY_DIR/${name}.so"
  if [[ ! -f "$so" ]]; then
    echo "missing $so" >&2
    exit 1
  fi
  solana-keygen new --no-bip39-passphrase -o "$WORK/program-keys/${name}.json" --force >/dev/null
  local pid
  pid="$(solana-keygen pubkey "$WORK/program-keys/${name}.json")"
  echo "  deploy $name → $pid"
  set +e
  OUT="$(solana program deploy "$so" \
    --program-id "$WORK/program-keys/${name}.json" \
    --upgrade-authority "$DEPLOYER_KP" \
    --keypair "$DEPLOYER_KP" \
    -u "$RPC" 2>&1)"
  RC=$?
  set -e
  echo "$OUT" | filter_cli
  if [[ "$RC" -ne 0 ]]; then
    echo "FAIL: deploy $name exit $RC" >&2
    exit 1
  fi
  echo "$pid" >"$WORK/${name}.program_id"
}

for name in kar_pro_staking kar_pro_pass; do
  deploy_one "$name"
done

STAKING_ID="$(cat "$WORK/kar_pro_staking.program_id")"
PASS_ID="$(cat "$WORK/kar_pro_pass.program_id")"

echo "==> assert upgrade authority = deployer"
for name in kar_pro_staking kar_pro_pass; do
  pid="$(cat "$WORK/${name}.program_id")"
  SHOW="$(solana program show "$pid" -u "$RPC")"
  if ! echo "$SHOW" | grep -q "Authority: $DEPLOYER_PUB"; then
    echo "FAIL: $name UA != deployer" >&2
    echo "$SHOW" >&2
    exit 1
  fi
done

echo "==> pair init + pin min stake (stated testnet constant recorded in evidence)"
pnpm exec tsx scripts/svm-s5-init-and-prove.ts \
  --staking "$STAKING_ID" \
  --pass "$PASS_ID" \
  --deployer-keypair "$DEPLOYER_KP" \
  --rpc "$RPC" \
  --evidence "$EVIDENCE" \
  --work "$WORK"

echo "==> S5 deploy + prove via svm-s5-init-and-prove.ts (no UA handoff)"
echo "    staking=$STAKING_ID"
echo "    pass=$PASS_ID"
echo "DONE (deployer retains UA)"
