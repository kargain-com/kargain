#!/usr/bin/env bash
# Founder-approved program-data extend to 125% of new artifact (S9-B).
# Separate from upgrade-in-place; never auto-extend on deploy.
# Pass --dry-run to print plan + rent deltas only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

DRY_RUN_ARGS=()
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN_ARGS=(--dry-run)
  shift
fi

: "${SOLANA_RPC_URL:?SOLANA_RPC_URL required}"
: "${SOLANA_DEPLOYER_PRIVATE_KEY:?SOLANA_DEPLOYER_PRIVATE_KEY required}"

MAT="$(pnpm exec tsx scripts/svm-materialize-deployer.ts)"
DEPLOYER_KP="$(echo "$MAT" | cut -f2)"
WORK="$(echo "$MAT" | cut -f3)"
cleanup() { rm -rf "${WORK:-}"; }
trap cleanup EXIT

# Artifacts must already exist from a prior Phase-1 dry-run build (or rebuild).
if [[ ! -f svm/target/deploy/kar_passport.so ]]; then
  echo "==> build four pre-S7a programs (--arch v3)"
  (cd svm/programs/kar-passport && cargo-build-sbf --arch v3)
  (cd svm/programs/kar-gateway && cargo-build-sbf --arch v3)
  (cd svm/programs/kar-pro-staking && cargo-build-sbf --arch v3)
  (cd svm/programs/kar-pro-pass && cargo-build-sbf --arch v3)
fi

pnpm exec tsx scripts/assert-solana-ua-matches-deployer.ts >/dev/null
EXTEND_CMD=(
  pnpm exec tsx scripts/svm-program-extend.ts
  --programs kar_passport,kar_gateway,kar_pro_staking,kar_pro_pass
  --so-dir svm/target/deploy
  --rpc "$SOLANA_RPC_URL"
  --deployer-keypair "$DEPLOYER_KP"
)
if [[ ${#DRY_RUN_ARGS[@]} -gt 0 ]]; then
  EXTEND_CMD+=("${DRY_RUN_ARGS[@]}")
fi
"${EXTEND_CMD[@]}"

if [[ ${#DRY_RUN_ARGS[@]} -gt 0 ]]; then
  echo "DONE — extend dry-run; no txs"
else
  echo "DONE — program-data extended to 125% of artifact; re-run upgrade dry-run"
fi
