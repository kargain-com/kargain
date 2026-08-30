#!/usr/bin/env bash
# S5-close — return passport UA → upgrade BPF → prove join/verify/leave/claim →
# hand passport+staking+pass UA to SOLANA_UPGRADE_AUTHORITY.
#
# Usage:
#   # load .env.local SOLANA_*
#   ./svm/scripts/s5-close-devnet.sh --upgrade-authority-keypair /path/to/BSuJ.json
#
# Stop if UA keypair missing or pubkey ≠ SOLANA_UPGRADE_AUTHORITY.
# Never --skip-new-upgrade-authority-signer-check.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

filter_cli() {
  grep -E -v -i \
    'seed phrase|Recover the intermediate|12-word|ephemeral keypair|To resume a deploy|solana-keygen recover|solana program close|=====|^[a-z]+( [a-z]+){11}$' \
    || true
}

UA_KP=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --upgrade-authority-keypair)
      UA_KP="${2:?}"
      shift 2
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$UA_KP" && -n "${S5_UPGRADE_AUTHORITY_KEYPAIR:-}" ]]; then
  UA_KP="$S5_UPGRADE_AUTHORITY_KEYPAIR"
fi

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
: "${SOLANA_UPGRADE_AUTHORITY:?SOLANA_UPGRADE_AUTHORITY required}"
: "${SOLANA_DEPLOYER_PRIVATE_KEY:?SOLANA_DEPLOYER_PRIVATE_KEY required}"

if [[ -z "$UA_KP" || ! -f "$UA_KP" ]]; then
  echo "STOP: upgrade-authority keypair required for begin-cycle return." >&2
  echo "  Pass --upgrade-authority-keypair <json> or set S5_UPGRADE_AUTHORITY_KEYPAIR (session only)." >&2
  echo "  Do not use --skip-new-upgrade-authority-signer-check." >&2
  exit 1
fi

RPC="$SOLANA_RPC_URL"
FINAL_UA="$SOLANA_UPGRADE_AUTHORITY"
PASSPORT_ID="FsDmjkrStitUPbh46y8JocGozNotF3EcT9rpDM1RDx1i"
EVIDENCE="$ROOT/deployments/svm-40168.json"

UA_PUB="$(solana-keygen pubkey "$UA_KP")"
if [[ "$UA_PUB" != "$FINAL_UA" ]]; then
  echo "STOP: keypair pubkey ${UA_PUB:0:8}… ≠ SOLANA_UPGRADE_AUTHORITY ${FINAL_UA:0:8}…" >&2
  exit 1
fi

echo "==> S5-close Devnet (authority cycle begin → prove → end)"
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
echo "    finalUA: ${FINAL_UA:0:4}…${FINAL_UA: -4}"

if [[ ! -f "$EVIDENCE" ]]; then
  echo "STOP: missing $EVIDENCE" >&2
  exit 1
fi

STAKING_ID="$(pnpm exec tsx -e "
import { readFileSync } from 'fs';
const e = JSON.parse(readFileSync('$EVIDENCE','utf8'));
const id = e.programs?.kar_pro_staking?.programId;
if (!id) throw new Error('kar_pro_staking missing from evidence');
process.stdout.write(id);
")"
PASS_ID="$(pnpm exec tsx -e "
import { readFileSync } from 'fs';
const e = JSON.parse(readFileSync('$EVIDENCE','utf8'));
const id = e.programs?.kar_pro_pass?.programId;
if (!id) throw new Error('kar_pro_pass missing from evidence');
process.stdout.write(id);
")"

echo "    staking=$STAKING_ID"
echo "    pass=$PASS_ID"
echo "    passport=$PASSPORT_ID"

echo "==> begin cycle: return passport UA → deployer"
SHOW_BEFORE="$(solana program show "$PASSPORT_ID" -u "$RPC")"
if echo "$SHOW_BEFORE" | grep -q "Authority: $DEPLOYER_PUB"; then
  echo "    passport UA already deployer — skip return"
elif echo "$SHOW_BEFORE" | grep -q "Authority: $FINAL_UA"; then
  solana program set-upgrade-authority "$PASSPORT_ID" \
    --new-upgrade-authority "$DEPLOYER_PUB" \
    --upgrade-authority "$UA_KP" \
    --keypair "$DEPLOYER_KP" \
    -u "$RPC" 2>&1 | filter_cli
  SHOW_MID="$(solana program show "$PASSPORT_ID" -u "$RPC")"
  if ! echo "$SHOW_MID" | grep -q "Authority: $DEPLOYER_PUB"; then
    echo "FAIL: passport UA return read-back" >&2
    echo "$SHOW_MID" >&2
    exit 1
  fi
  echo "    passport UA → deployer OK"
else
  echo "FAIL: unexpected passport authority" >&2
  echo "$SHOW_BEFORE" >&2
  exit 1
fi

echo "==> build + upgrade passport BPF (--arch v3)"
(cd svm/programs/kar-passport && cargo-build-sbf --arch v3)
SO="$ROOT/svm/target/deploy/kar_passport.so"
if [[ ! -f "$SO" ]]; then
  echo "missing $SO" >&2
  exit 1
fi
set +e
OUT="$(solana program deploy "$SO" \
  --program-id "$PASSPORT_ID" \
  --upgrade-authority "$DEPLOYER_KP" \
  --keypair "$DEPLOYER_KP" \
  -u "$RPC" 2>&1)"
RC=$?
set -e
echo "$OUT" | filter_cli
if [[ "$RC" -ne 0 ]]; then
  echo "FAIL: passport upgrade exit $RC" >&2
  exit 1
fi
echo "    passport BPF upgraded"

echo "==> prove join → verify → leave → close → claim + hand all three UA"
pnpm exec tsx scripts/svm-s5-init-and-prove.ts \
  --staking "$STAKING_ID" \
  --pass "$PASS_ID" \
  --deployer-keypair "$DEPLOYER_KP" \
  --rpc "$RPC" \
  --evidence "$EVIDENCE" \
  --work "$WORK" \
  --hand-passport-ua

echo "==> final UA read-back"
for name_pid in "kar_passport:$PASSPORT_ID" "kar_pro_staking:$STAKING_ID" "kar_pro_pass:$PASS_ID"; do
  name="${name_pid%%:*}"
  pid="${name_pid#*:}"
  SHOW="$(solana program show "$pid" -u "$RPC")"
  if ! echo "$SHOW" | grep -q "Authority: $FINAL_UA"; then
    echo "FAIL: $name Authority ≠ SOLANA_UPGRADE_AUTHORITY" >&2
    echo "$SHOW" >&2
    exit 1
  fi
  echo "    $name Authority OK (${FINAL_UA:0:4}…)"
done

echo "S5-close Devnet PASS"
