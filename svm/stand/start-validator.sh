#!/usr/bin/env bash
# Start local validator with Metaplex Core + SPL noop.
# Default: also preload the four Kargain stand programs via --bpf-program.
# Upgradeable mode (KARGAIN_SVM_STAND_LOAD=upgradeable): Core+noop only —
#   deploy the four programs afterward with deploy-stand-programs.sh.
#
# Price accounts: prepare-price-accounts.sh injects receiver-owned PriceUpdateV2
# (Devnet clone preferred; fixture fallback). No Kargain program writes price.
#
# No Devnet writes (clone is read-only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAND="$(cd "$(dirname "$0")" && pwd)"
FIXTURES="$ROOT/lab/fixtures"
# Preload default = stand v0 dir; upgradeable run-stand exports deploy-v3.
DEPLOY="${KARGAIN_SVM_STAND_DEPLOY_DIR:-$ROOT/target/deploy}"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

LOAD="${KARGAIN_SVM_STAND_LOAD:-preload}"

# Per-program .so override (mixed-version). Same env as stand-artifact-bindings.ts:
#   KARGAIN_SVM_STAND_SO_OVERRIDE=kar_gateway=/abs/path.so,kar_passport=/other.so
# Missing override path → stand_so_override_missing (never silent fallback to deploy).
# Bash 3.2 compatible (no associative arrays).
stand_so_override_path() {
  local want="$1"
  local raw="${KARGAIN_SVM_STAND_SO_OVERRIDE:-}"
  [[ -z "$raw" ]] && return 1
  local OLDIFS="$IFS"
  IFS=','
  # shellcheck disable=SC2086
  set -- $raw
  IFS="$OLDIFS"
  local part stem so_path
  for part in "$@"; do
    # trim
    part="${part#"${part%%[![:space:]]*}"}"
    part="${part%"${part##*[![:space:]]}"}"
    [[ -z "$part" ]] && continue
    case "$part" in
      *=*) ;;
      *)
        echo "stand_so_override_missing: malformed override entry ${part} (want stem=/abs/path.so)" >&2
        exit 1
        ;;
    esac
    stem="${part%%=*}"
    so_path="${part#*=}"
    stem="${stem#"${stem%%[![:space:]]*}"}"
    stem="${stem%"${stem##*[![:space:]]}"}"
    so_path="${so_path#"${so_path%%[![:space:]]*}"}"
    so_path="${so_path%"${so_path##*[![:space:]]}"}"
    if [[ -z "$stem" || -z "$so_path" ]]; then
      echo "stand_so_override_missing: empty stem or path in ${part}" >&2
      exit 1
    fi
    if [[ "$stem" == "$want" ]]; then
      printf '%s\n' "$so_path"
      return 0
    fi
  done
  return 1
}

resolve_program_so() {
  local name="$1"
  local so
  if so="$(stand_so_override_path "$name")"; then
    if [[ ! -f "$so" ]]; then
      echo "stand_so_override_missing: ${name}=${so}" >&2
      exit 1
    fi
    printf '%s\n' "$so"
    return 0
  fi
  printf '%s\n' "$DEPLOY/${name}.so"
}

CORE=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
NOOP=noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV

CORE_SO="$FIXTURES/mpl_core_release_0.15.1.so"
if [[ ! -f "$CORE_SO" ]]; then
  CORE_SO="$FIXTURES/mpl_core.so"
fi

need_so() {
  local name="$1"
  local so
  so="$(resolve_program_so "$name")"
  local kp="$DEPLOY/${name}-keypair.json"
  if [[ ! -f "$so" ]]; then
    if stand_so_override_path "$name" >/dev/null 2>&1; then
      echo "stand_so_override_missing: ${name}=${so}" >&2
    else
      echo "missing $so — build with cargo-build-sbf (see svm/README.md)" >&2
    fi
    exit 1
  fi
  if [[ ! -f "$kp" ]]; then
    echo "missing $kp — build with cargo-build-sbf (see svm/README.md)" >&2
    exit 1
  fi
  echo "$(solana-keygen pubkey "$kp")"
}

LEDGER="${SVM_STAND_LEDGER:-/tmp/kargain-svm-stand-ledger}"
rm -rf "$LEDGER"
mkdir -p "$LEDGER"

# Outside ledger: --reset wipes the ledger dir before --account-dir is read.
PRICE_ACCOUNTS="${KARGAIN_SVM_STAND_PRICE_ACCOUNTS:-/tmp/kargain-svm-stand-price-accounts}"
PRICE_BOOT="${KARGAIN_SVM_STAND_PRICE_BOOT:-/tmp/kargain-svm-stand-price-boot.json}"
bash "$STAND/prepare-price-accounts.sh" "$PRICE_ACCOUNTS" "$PRICE_BOOT"

ARGS=(
  --ledger "$LEDGER"
  --reset
  --quiet
  --bpf-program "$CORE" "$CORE_SO"
  --bpf-program "$NOOP" "$FIXTURES/spl_noop.so"
  --account-dir "$PRICE_ACCOUNTS"
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
  MOCK_ENDPOINT_SO="$(resolve_program_so mock_endpoint)"
  KAR_PASSPORT_SO="$(resolve_program_so kar_passport)"
  KAR_GATEWAY_SO="$(resolve_program_so kar_gateway)"
  MOCK_STAKING_SO="$(resolve_program_so mock_staking)"
  KAR_PRO_STAKING_SO="$(resolve_program_so kar_pro_staking)"
  KAR_PRO_PASS_SO="$(resolve_program_so kar_pro_pass)"
  MONEY_HARNESS_SO="$(resolve_program_so money_harness)"
  CONSIGNMENT_HARNESS_SO="$(resolve_program_so consignment_harness)"
  KAR_FIXED_PRICE_SO="$(resolve_program_so kar_fixed_price)"
  KAR_ASCENDING_SO="$(resolve_program_so kar_ascending)"
  if stand_so_override_path kar_gateway >/dev/null 2>&1; then
    echo "  override kar_gateway → $KAR_GATEWAY_SO" >&2
  fi
  ARGS+=(
    --bpf-program "$MOCK_ENDPOINT_ID" "$MOCK_ENDPOINT_SO"
    --bpf-program "$KAR_PASSPORT_ID" "$KAR_PASSPORT_SO"
    --bpf-program "$KAR_GATEWAY_ID" "$KAR_GATEWAY_SO"
    --bpf-program "$MOCK_STAKING_ID" "$MOCK_STAKING_SO"
    --bpf-program "$KAR_PRO_STAKING_ID" "$KAR_PRO_STAKING_SO"
    --bpf-program "$KAR_PRO_PASS_ID" "$KAR_PRO_PASS_SO"
    --bpf-program "$MONEY_HARNESS_ID" "$MONEY_HARNESS_SO"
    --bpf-program "$CONSIGNMENT_HARNESS_ID" "$CONSIGNMENT_HARNESS_SO"
    --bpf-program "$KAR_FIXED_PRICE_ID" "$KAR_FIXED_PRICE_SO"
    --bpf-program "$KAR_ASCENDING_ID" "$KAR_ASCENDING_SO"
  )
fi

exec solana-test-validator "${ARGS[@]}" "$@"
