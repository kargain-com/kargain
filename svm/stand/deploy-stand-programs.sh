#!/usr/bin/env bash
# Deploy the four stand programs through the upgradeable loader onto a running
# local validator. Program ids come from svm/target/deploy/*-keypair.json
# (same ids live-roundtrip.ts reads). No Devnet writes.
#
# Prerequisites: validator up at RPC; artifacts built with --arch v3.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$ROOT/target/deploy"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

RPC="${SVM_STAND_RPC:-http://127.0.0.1:8899}"
WORK="${SVM_STAND_DEPLOY_WORK:-/tmp/kargain-svm-stand-deploy}"
rm -rf "$WORK"
mkdir -p "$WORK"

filter_cli() {
  # Drop buffer-recovery banners and bare 12-word mnemonic lines (never log key material).
  grep -E -v -i \
    'seed phrase|Recover the intermediate|12-word|ephemeral keypair|To resume a deploy|solana-keygen recover|solana program close|=====|^[a-z]+( [a-z]+){11}$' \
    || true
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing $1" >&2
    exit 1
  }
}
need_cmd solana
need_cmd solana-keygen

solana-keygen new --no-bip39-passphrase -o "$WORK/payer.json" --force >/dev/null
solana-keygen new --no-bip39-passphrase -o "$WORK/upgrade-authority.json" --force >/dev/null
AUTH="$(solana-keygen pubkey "$WORK/upgrade-authority.json")"
echo "stand upgradeable deploy → $RPC (upgrade-authority $AUTH)"

solana config set --url "$RPC" --keypair "$WORK/payer.json" >/dev/null
# Validator may already have funds from prior airdrops; ignore failure if capped.
solana airdrop 100 >/dev/null 2>&1 || true

deploy_one() {
  local name="$1"
  local so="$DEPLOY/${name}.so"
  local kp="$DEPLOY/${name}-keypair.json"
  if [[ ! -f "$so" || ! -f "$kp" ]]; then
    echo "missing $so or $kp — build with cargo-build-sbf --arch v3" >&2
    exit 1
  fi
  local pid
  pid="$(solana-keygen pubkey "$kp")"
  echo "  deploy $name → $pid"
  set +e
  OUT="$(solana program deploy "$so" \
    --program-id "$kp" \
    --upgrade-authority "$WORK/upgrade-authority.json" \
    --keypair "$WORK/payer.json" 2>&1)"
  RC=$?
  set -e
  echo "$OUT" | filter_cli
  if [[ "$RC" -ne 0 ]]; then
    echo "deploy $name failed (exit $RC)" >&2
    exit 1
  fi
  SHOW="$(solana program show "$pid" -u "$RPC")"
  if ! echo "$SHOW" | grep -q "Authority: $AUTH"; then
    echo "FAIL: $name authority mismatch" >&2
    echo "$SHOW" >&2
    exit 1
  fi
  if ! echo "$SHOW" | grep -q "Owner: BPFLoaderUpgradeab1e"; then
    echo "FAIL: $name not owned by upgradeable loader" >&2
    echo "$SHOW" >&2
    exit 1
  fi
}

for name in mock_endpoint kar_passport kar_gateway mock_staking kar_pro_staking kar_pro_pass; do
  deploy_one "$name"
done

echo "stand upgradeable deploy PASS (6 programs)"
