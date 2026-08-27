#!/usr/bin/env bash
# Start local validator with cloned Metaplex Core (+ noop) and S3 stand programs.
# No Devnet writes. Load via --bpf-program (Agave 4.2 rejects upgradeable deploy of v1.54).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
FIXTURES="$ROOT/lab/fixtures"
DEPLOY="$ROOT/target/deploy"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

CORE=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
NOOP=noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV

CORE_SO="$FIXTURES/mpl_core_release_0.15.1.so"
if [[ ! -f "$CORE_SO" ]]; then
  CORE_SO="$FIXTURES/mpl_core.so"
fi

need_so() {
  local name="$1"
  local so="$DEPLOY/${name}.so"
  local kp="$DEPLOY/${name}-keypair.json"
  if [[ ! -f "$so" || ! -f "$kp" ]]; then
    echo "missing $so or $kp — build with cargo-build-sbf --arch v0 from svm/programs/${name//_/-}" >&2
    exit 1
  fi
  echo "$(solana-keygen pubkey "$kp")"
}

MOCK_ENDPOINT_ID="$(need_so mock_endpoint)"
KAR_PASSPORT_ID="$(need_so kar_passport)"
KAR_GATEWAY_ID="$(need_so kar_gateway)"
MOCK_STAKING_ID="$(need_so mock_staking)"

LEDGER="${SVM_STAND_LEDGER:-/tmp/kargain-svm-stand-ledger}"
rm -rf "$LEDGER"
mkdir -p "$LEDGER"

echo "stand programs:" >&2
echo "  mock_endpoint  $MOCK_ENDPOINT_ID" >&2
echo "  kar_passport   $KAR_PASSPORT_ID" >&2
echo "  kar_gateway    $KAR_GATEWAY_ID" >&2
echo "  mock_staking   $MOCK_STAKING_ID" >&2
echo "  mpl-core       $CORE" >&2

exec solana-test-validator \
  --ledger "$LEDGER" \
  --reset \
  --quiet \
  --bpf-program "$CORE" "$CORE_SO" \
  --bpf-program "$NOOP" "$FIXTURES/spl_noop.so" \
  --bpf-program "$MOCK_ENDPOINT_ID" "$DEPLOY/mock_endpoint.so" \
  --bpf-program "$KAR_PASSPORT_ID" "$DEPLOY/kar_passport.so" \
  --bpf-program "$KAR_GATEWAY_ID" "$DEPLOY/kar_gateway.so" \
  --bpf-program "$MOCK_STAKING_ID" "$DEPLOY/mock_staking.so" \
  "$@"
