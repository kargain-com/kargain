#!/usr/bin/env bash
# S4a T1 — prove upgradeable-loader deploy + set-upgrade-authority on a local
# Agave matching Solana Devnet. No Devnet writes.
#
# Required toolchain (pinned in svm/README.md):
#   Agave / solana-cli == Devnet getVersion (recorded 2026-08-29: 4.3.0-beta.2)
#   cargo-build-sbf with platform-tools v1.56+
#   cargo-build-sbf --arch v3   (v0/v1/v2 rejected by upgradeable loader after SIMD-0500)
#
# Usage:
#   ./svm/scripts/prove-upgradeable-deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"   # svm/
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

WORK="${SVM_UPGRADEABLE_WORK:-/tmp/kargain-s4a-upgradeable}"
LEDGER="${SVM_UPGRADEABLE_LEDGER:-/tmp/kargain-s4a-upgradeable-ledger}"
RPC="${SVM_UPGRADEABLE_RPC:-http://127.0.0.1:8899}"
PROGRAM_NAME="${PROGRAM_NAME:-mock_endpoint}"
PROGRAM_DIR_NAME="${PROGRAM_DIR_NAME:-mock-endpoint}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1 (install Agave matching Devnet; see svm/README.md)" >&2
    exit 1
  }
}
need_cmd solana
need_cmd solana-test-validator
need_cmd cargo-build-sbf
need_cmd solana-keygen

# Strip buffer-recovery seed banners from CLI noise (never log key material).
filter_cli() {
  grep -E -v -i \
    'seed phrase|Recover the intermediate|12-word|ephemeral keypair|To resume a deploy|solana-keygen recover|solana program close|=====' \
    || true
}

echo "==> local Agave: $(solana --version)"
echo "==> cargo-build-sbf: $(cargo-build-sbf --version)"

echo "==> build ${PROGRAM_DIR_NAME} (--arch v3)"
(cd "$ROOT/programs/$PROGRAM_DIR_NAME" && cargo-build-sbf --arch v3)
SO="${PROGRAM_SO:-$ROOT/target/deploy/${PROGRAM_NAME}.so}"
if [[ ! -f "$SO" ]]; then
  echo "missing $SO" >&2
  exit 1
fi
echo "    artifact: $SO ($(wc -c <"$SO") bytes)"

rm -rf "$WORK" "$LEDGER"
mkdir -p "$WORK"

solana-keygen new --no-bip39-passphrase -o "$WORK/payer.json" --force >/dev/null
solana-keygen new --no-bip39-passphrase -o "$WORK/authority-a.json" --force >/dev/null
solana-keygen new --no-bip39-passphrase -o "$WORK/authority-b.json" --force >/dev/null
solana-keygen new --no-bip39-passphrase -o "$WORK/program.json" --force >/dev/null

AUTH_A="$(solana-keygen pubkey "$WORK/authority-a.json")"
AUTH_B="$(solana-keygen pubkey "$WORK/authority-b.json")"
PROG="$(solana-keygen pubkey "$WORK/program.json")"
echo "    program id:          $PROG"
echo "    upgrade authority A: $AUTH_A"
echo "    upgrade authority B: $AUTH_B"

echo "==> start solana-test-validator (bare; no --bpf-program for this program)"
solana-test-validator --ledger "$LEDGER" --reset --quiet >"$WORK/validator.log" 2>&1 &
VAL_PID=$!
cleanup() {
  kill "$VAL_PID" 2>/dev/null || true
  wait "$VAL_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "    waiting for $RPC …"
for i in $(seq 1 90); do
  if solana cluster-version -u "$RPC" >/dev/null 2>&1; then
    echo "    validator: $(solana cluster-version -u "$RPC")"
    break
  fi
  if ! kill -0 "$VAL_PID" 2>/dev/null; then
    echo "validator exited early — log:" >&2
    cat "$WORK/validator.log" >&2
    exit 1
  fi
  if [[ "$i" -eq 90 ]]; then
    echo "validator not ready after 90s — log:" >&2
    cat "$WORK/validator.log" >&2
    exit 1
  fi
  sleep 1
done

solana config set --url "$RPC" --keypair "$WORK/payer.json" >/dev/null
solana airdrop 100 >/dev/null

echo "==> solana program deploy (upgradeable loader, --upgrade-authority A)"
set +e
DEPLOY_OUT="$(solana program deploy "$SO" \
  --program-id "$WORK/program.json" \
  --upgrade-authority "$WORK/authority-a.json" \
  --keypair "$WORK/payer.json" 2>&1)"
DEPLOY_RC=$?
set -e
echo "$DEPLOY_OUT" | filter_cli
if [[ "$DEPLOY_RC" -ne 0 ]]; then
  echo "deploy failed (exit $DEPLOY_RC)" >&2
  exit 1
fi

SHOW_AFTER_DEPLOY="$(solana program show "$PROG" -u "$RPC")"
echo "$SHOW_AFTER_DEPLOY"
if ! echo "$SHOW_AFTER_DEPLOY" | grep -q "Authority: $AUTH_A"; then
  echo "FAIL: expected Authority $AUTH_A after deploy" >&2
  exit 1
fi
echo "    ✓ upgrade authority after deploy = A"

echo "==> solana program set-upgrade-authority A → B"
solana program set-upgrade-authority "$PROG" \
  --new-upgrade-authority "$WORK/authority-b.json" \
  --upgrade-authority "$WORK/authority-a.json" \
  --keypair "$WORK/payer.json" >/dev/null

SHOW_AFTER_MOVE="$(solana program show "$PROG" -u "$RPC")"
echo "$SHOW_AFTER_MOVE"
if ! echo "$SHOW_AFTER_MOVE" | grep -q "Authority: $AUTH_B"; then
  echo "FAIL: expected Authority $AUTH_B after set-upgrade-authority" >&2
  exit 1
fi
echo "    ✓ upgrade authority after move = B"

echo "==> PASS — upgradeable deploy path proven on local Agave $(solana cluster-version -u "$RPC")"
