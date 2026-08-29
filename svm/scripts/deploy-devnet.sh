#!/usr/bin/env bash
# S4b X3 — Solana Devnet upgradeable deploy (passport + gateway + aux mock_staking).
# Sequence: build → deploy → set-upgrade-authority (hot) → read-back → init → evidence.
# Never logs private keys. Requires SOLANA_* in the environment (.env.local loaded by callers).
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
need_cmd node
need_cmd pnpm

# Fail-closed public roles (values not echoed beyond fingerprints later)
: "${SOLANA_RPC_URL:?SOLANA_RPC_URL required}"
: "${SOLANA_UPGRADE_AUTHORITY:?SOLANA_UPGRADE_AUTHORITY required}"
: "${SOLANA_FORFEIT_RECIPIENT:?SOLANA_FORFEIT_RECIPIENT required}"
: "${SOLANA_LZ_ENDPOINT:?SOLANA_LZ_ENDPOINT required}"
: "${SOLANA_DEPLOYER_PRIVATE_KEY:?SOLANA_DEPLOYER_PRIVATE_KEY required}"

RPC="$SOLANA_RPC_URL"
UPGRADE_AUTH="$SOLANA_UPGRADE_AUTHORITY"
FORFEIT="$SOLANA_FORFEIT_RECIPIENT"
ENDPOINT="$SOLANA_LZ_ENDPOINT"
GATEWAY_AUTH="${SOLANA_GATEWAY_AUTHORITY:-}"

echo "==> S4b X3 Devnet deploy"
echo "    rpc: $RPC"
echo "    upgradeAuthority: ${UPGRADE_AUTH:0:4}…${UPGRADE_AUTH: -4}"
echo "    forfeit: ${FORFEIT:0:4}…${FORFEIT: -4}"
echo "    lzEndpoint: ${ENDPOINT:0:4}…${ENDPOINT: -4}"

# Materialize deployer (stdout: pubkey path workDir)
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
if [[ -n "$GATEWAY_AUTH" && "$GATEWAY_AUTH" != "$DEPLOYER_PUB" ]]; then
  echo "FAIL: SOLANA_GATEWAY_AUTHORITY must be empty or equal deployer pubkey (init signer)." >&2
  echo "      gateway config authority is the Initialize signer; only SOLANA_DEPLOYER_PRIVATE_KEY is available." >&2
  exit 1
fi
GATEWAY_AUTH="$DEPLOYER_PUB"
echo "    gatewayAuthority: $GATEWAY_AUTH (deployer)"

BAL="$(solana balance "$DEPLOYER_PUB" -u "$RPC" 2>/dev/null | awk '{print $1}')"
echo "    balance: ${BAL:-?} SOL"
if [[ -z "$BAL" ]]; then
  echo "FAIL: cannot read deployer balance on $RPC" >&2
  exit 1
fi

echo "==> build kar_passport + kar_gateway + mock_staking (--arch v3)"
(cd svm/programs/kar-passport && cargo-build-sbf --arch v3)
(cd svm/programs/kar-gateway && cargo-build-sbf --arch v3)
(cd svm/programs/mock-staking && cargo-build-sbf --arch v3)

DEPLOY_DIR="$ROOT/svm/target/deploy"
EVIDENCE_DIR="$ROOT/deployments"
mkdir -p "$EVIDENCE_DIR" "$WORK/program-keys"

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

for name in kar_passport kar_gateway mock_staking; do
  deploy_one "$name"
done

PASSPORT_ID="$(cat "$WORK/kar_passport.program_id")"
GATEWAY_ID="$(cat "$WORK/kar_gateway.program_id")"
STAKING_ID="$(cat "$WORK/mock_staking.program_id")"

echo "==> set-upgrade-authority → hot upgrade authority"
for name in kar_passport kar_gateway mock_staking; do
  pid="$(cat "$WORK/${name}.program_id")"
  echo "  $name ($pid)"
  solana program set-upgrade-authority "$pid" \
    --new-upgrade-authority "$UPGRADE_AUTH" \
    --skip-new-upgrade-authority-signer-check \
    --upgrade-authority "$DEPLOYER_KP" \
    --keypair "$DEPLOYER_KP" \
    -u "$RPC" 2>&1 | filter_cli
  SHOW="$(solana program show "$pid" -u "$RPC" -k "$DEPLOYER_KP")"
  if ! echo "$SHOW" | grep -q "Authority: $UPGRADE_AUTH"; then
    echo "FAIL: $name upgrade authority read-back ≠ SOLANA_UPGRADE_AUTHORITY" >&2
    echo "$SHOW" >&2
    exit 1
  fi
  if ! echo "$SHOW" | grep -q "Owner: BPFLoaderUpgradeab1e"; then
    echo "FAIL: $name not upgradeable loader" >&2
    echo "$SHOW" >&2
    exit 1
  fi
  echo "    authority OK"
done

echo "==> init configs (passport + gateway + setBridgeGateway)"
export SVM_X3_PASSPORT_PROGRAM="$PASSPORT_ID"
export SVM_X3_GATEWAY_PROGRAM="$GATEWAY_ID"
export SVM_X3_STAKING_PROGRAM="$STAKING_ID"
export SVM_X3_DEPLOYER_KEYPAIR="$DEPLOYER_KP"
pnpm exec tsx scripts/svm-devnet-init.ts

SLOT="$(solana slot -u "$RPC")"
GIT_HEAD="$(git rev-parse HEAD)"
TOOLCHAIN="$(solana --version | head -1)"
BUILD_SBF="$(cargo-build-sbf --version | head -1)"

export SVM_X3_DEPLOYER_PUBKEY="$DEPLOYER_PUB"
export SVM_X3_GATEWAY_AUTH="$GATEWAY_AUTH"
export SVM_X3_SLOT="$SLOT"
export SVM_X3_GIT_HEAD="$GIT_HEAD"
export SVM_X3_TOOLCHAIN="$TOOLCHAIN"
export SVM_X3_BUILD_SBF="$BUILD_SBF"

EVIDENCE="$EVIDENCE_DIR/svm-40168.json"
python3 - "$EVIDENCE" <<'PY'
import json, os, sys, hashlib, pathlib
path = sys.argv[1]
deploy_dir = pathlib.Path("svm/target/deploy")

def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

programs = {}
for name, envk in [
    ("kar_passport", "SVM_X3_PASSPORT_PROGRAM"),
    ("kar_gateway", "SVM_X3_GATEWAY_PROGRAM"),
    ("mock_staking", "SVM_X3_STAKING_PROGRAM"),
]:
    so = deploy_dir / f"{name}.so"
    programs[name] = {
        "programId": os.environ[envk],
        "soSha256": sha256_file(so) if so.exists() else None,
        "soBytes": so.stat().st_size if so.exists() else None,
        "upgradeAuthority": os.environ["SOLANA_UPGRADE_AUTHORITY"],
    }

doc = {
    "cluster": "solana-devnet",
    "eid": 40168,
    "namespace": 2000040168,
    "rpcUrl": os.environ["SOLANA_RPC_URL"],
    "layerZeroEndpoint": os.environ["SOLANA_LZ_ENDPOINT"],
    "deployerPubkey": os.environ["SVM_X3_DEPLOYER_PUBKEY"],
    "gatewayConfigAuthority": os.environ["SVM_X3_GATEWAY_AUTH"],
    "forfeitRecipient": os.environ["SOLANA_FORFEIT_RECIPIENT"],
    "upgradeAuthority": os.environ["SOLANA_UPGRADE_AUTHORITY"],
    "programs": programs,
    "slotAtEvidence": int(os.environ["SVM_X3_SLOT"]),
    "deployGitHead": os.environ["SVM_X3_GIT_HEAD"],
    "solanaCli": os.environ["SVM_X3_TOOLCHAIN"],
    "cargoBuildSbf": os.environ["SVM_X3_BUILD_SBF"],
    "commercialActive": False,
    "note": "S4b X3 — not cut over; no COMMERCIAL_ACTIVE Solana row",
}
pathlib.Path(path).write_text(json.dumps(doc, indent=2) + "\n")
print(f"evidence → {path}")
PY

echo "==> X3 deploy PASS"
echo "    passport: $PASSPORT_ID"
echo "    gateway:  $GATEWAY_ID"
echo "    staking:  $STAKING_ID (aux)"
echo "    evidence: $EVIDENCE"
