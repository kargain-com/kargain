#!/usr/bin/env bash
# Start local validator with Metaplex Core + SPL noop.
# Default: also preload the four Kargain stand programs via --bpf-program.
# Upgradeable mode (KARGAIN_SVM_STAND_LOAD=upgradeable): Core+noop only —
#   deploy the four programs afterward with deploy-stand-programs.sh.
#
# No Devnet writes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURES="$ROOT/lab/fixtures"
DEPLOY="$ROOT/target/deploy"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

LOAD="${KARGAIN_SVM_STAND_LOAD:-preload}"

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
    echo "missing $so or $kp — build with cargo-build-sbf (see svm/README.md)" >&2
    exit 1
  fi
  echo "$(solana-keygen pubkey "$kp")"
}

LEDGER="${SVM_STAND_LEDGER:-/tmp/kargain-svm-stand-ledger}"
rm -rf "$LEDGER"
mkdir -p "$LEDGER"

ARGS=(
  --ledger "$LEDGER"
  --reset
  --quiet
  --bpf-program "$CORE" "$CORE_SO"
  --bpf-program "$NOOP" "$FIXTURES/spl_noop.so"
)

if [[ "$LOAD" == "upgradeable" ]]; then
  echo "stand load=upgradeable — Core+noop only; deploy programs after start" >&2
  echo "  mpl-core       $CORE" >&2
else
  MOCK_ENDPOINT_ID="$(need_so mock_endpoint)"
  KAR_PASSPORT_ID="$(need_so kar_passport)"
  KAR_GATEWAY_ID="$(need_so kar_gateway)"
  MOCK_STAKING_ID="$(need_so mock_staking)"
  KAR_PRO_STAKING_ID="$(need_so kar_pro_staking)"
  KAR_PRO_PASS_ID="$(need_so kar_pro_pass)"
  MONEY_HARNESS_ID="$(need_so money_harness)"
  CONSIGNMENT_HARNESS_ID="$(need_so consignment_harness)"
  KAR_FIXED_PRICE_ID="$(need_so kar_fixed_price)"
  KAR_ASCENDING_ID="$(need_so kar_ascending)"
  echo "stand load=preload (--bpf-program):" >&2
  echo "  mock_endpoint  $MOCK_ENDPOINT_ID" >&2
  echo "  kar_passport   $KAR_PASSPORT_ID" >&2
  echo "  kar_gateway    $KAR_GATEWAY_ID" >&2
  echo "  mock_staking   $MOCK_STAKING_ID" >&2
  echo "  kar_pro_staking $KAR_PRO_STAKING_ID" >&2
  echo "  kar_pro_pass   $KAR_PRO_PASS_ID" >&2
  echo "  money_harness  $MONEY_HARNESS_ID" >&2
  echo "  consignment_harness $CONSIGNMENT_HARNESS_ID" >&2
  echo "  kar_fixed_price $KAR_FIXED_PRICE_ID" >&2
  echo "  kar_ascending  $KAR_ASCENDING_ID" >&2
  echo "  mpl-core       $CORE" >&2
  ARGS+=(
    --bpf-program "$MOCK_ENDPOINT_ID" "$DEPLOY/mock_endpoint.so"
    --bpf-program "$KAR_PASSPORT_ID" "$DEPLOY/kar_passport.so"
    --bpf-program "$KAR_GATEWAY_ID" "$DEPLOY/kar_gateway.so"
    --bpf-program "$MOCK_STAKING_ID" "$DEPLOY/mock_staking.so"
    --bpf-program "$KAR_PRO_STAKING_ID" "$DEPLOY/kar_pro_staking.so"
    --bpf-program "$KAR_PRO_PASS_ID" "$DEPLOY/kar_pro_pass.so"
    --bpf-program "$MONEY_HARNESS_ID" "$DEPLOY/money_harness.so"
    --bpf-program "$CONSIGNMENT_HARNESS_ID" "$DEPLOY/consignment_harness.so"
    --bpf-program "$KAR_FIXED_PRICE_ID" "$DEPLOY/kar_fixed_price.so"
    --bpf-program "$KAR_ASCENDING_ID" "$DEPLOY/kar_ascending.so"
  )
fi

exec solana-test-validator "${ARGS[@]}" "$@"
