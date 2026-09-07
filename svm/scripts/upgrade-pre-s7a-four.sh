#!/usr/bin/env bash
# Upgrade the four pre-S7a commercial programs in place (registry program ids).
# Unit S9-B-2 — no new program keypairs.
# Pass --dry-run for Phase 1 preflight (build + show + digests + retention; no txs).
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

echo "==> build four pre-S7a programs (--arch v3)"
(cd svm/programs/kar-passport && cargo-build-sbf --arch v3)
(cd svm/programs/kar-gateway && cargo-build-sbf --arch v3)
(cd svm/programs/kar-pro-staking && cargo-build-sbf --arch v3)
(cd svm/programs/kar-pro-pass && cargo-build-sbf --arch v3)

pnpm exec tsx scripts/assert-solana-ua-matches-deployer.ts >/dev/null
UPGRADE_CMD=(
  pnpm exec tsx scripts/svm-upgrade-in-place.ts
  --programs kar_passport,kar_gateway,kar_pro_staking,kar_pro_pass
  --so-dir svm/target/deploy
  --rpc "$SOLANA_RPC_URL"
  --deployer-keypair "$DEPLOYER_KP"
  --evidence deployments/svm-40168.json
)
if [[ ${#DRY_RUN_ARGS[@]} -gt 0 ]]; then
  UPGRADE_CMD+=("${DRY_RUN_ARGS[@]}")
fi
"${UPGRADE_CMD[@]}"

if [[ ${#DRY_RUN_ARGS[@]} -gt 0 ]]; then
  echo "DONE — Phase 1 dry-run; no upgrade txs; deploySlot unchanged"
else
  echo "DONE — four programs upgraded; evidence digests refreshed; deploySlot unchanged"
fi
