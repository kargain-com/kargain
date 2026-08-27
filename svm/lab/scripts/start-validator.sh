#!/usr/bin/env bash
# Start local validator with cloned Metaplex Core (+ noop) and optional lab_harness.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURES="$ROOT/fixtures"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

CORE=CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
NOOP=noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV

# Prefer release fixture when present (matches mpl-core JS 1.x AccountState path).
CORE_SO="$FIXTURES/mpl_core_release_0.15.1.so"
if [[ ! -f "$CORE_SO" ]]; then
  CORE_SO="$FIXTURES/mpl_core.so"
fi

LEDGER="${SVM_LAB_LEDGER:-/tmp/kargain-svm-lab-ledger}"
rm -rf "$LEDGER"
mkdir -p "$LEDGER"

HARNESS_ARGS=()
HARNESS_SO="${LAB_HARNESS_SO:-$ROOT/programs/lab_harness/target/deploy/lab_harness.so}"
HARNESS_KP="${LAB_HARNESS_KEYPAIR:-$ROOT/programs/lab_harness/target/deploy/lab_harness-keypair.json}"
if [[ -f "$HARNESS_SO" && -f "$HARNESS_KP" ]]; then
  HARNESS_ID="$(solana-keygen pubkey "$HARNESS_KP")"
  HARNESS_ARGS=(--bpf-program "$HARNESS_ID" "$HARNESS_SO")
  echo "lab_harness: $HARNESS_ID" >&2
fi

exec solana-test-validator \
  --ledger "$LEDGER" \
  --reset \
  --quiet \
  --bpf-program "$CORE" "$CORE_SO" \
  --bpf-program "$NOOP" "$FIXTURES/spl_noop.so" \
  "${HARNESS_ARGS[@]}" \
  "$@"
