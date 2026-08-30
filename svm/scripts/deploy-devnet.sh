#!/usr/bin/env bash
# Solana Devnet upgradeable deploy (passport + gateway + aux mock_staking).
# Sequence: build → deploy → **retain deployer as upgrade authority** → read-back → init → evidence.
# S4–S8: SOLANA_UPGRADE_AUTHORITY must equal deployer pubkey (no handoff).
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

: "${SOLANA_RPC_URL:?SOLANA_RPC_URL required}"
: "${SOLANA_FORFEIT_RECIPIENT:?SOLANA_FORFEIT_RECIPIENT required}"
: "${SOLANA_LZ_ENDPOINT:?SOLANA_LZ_ENDPOINT required}"
: "${SOLANA_DEPLOYER_PRIVATE_KEY:?SOLANA_DEPLOYER_PRIVATE_KEY required}"
# SOLANA_UPGRADE_AUTHORITY: sole check via assert-solana-ua-matches-deployer.ts (do not read here)

RPC="$SOLANA_RPC_URL"
FORFEIT="$SOLANA_FORFEIT_RECIPIENT"
ENDPOINT="$SOLANA_LZ_ENDPOINT"
GATEWAY_AUTH="${SOLANA_GATEWAY_AUTHORITY:-}"

echo "==> Devnet deploy (retain deployer upgrade authority)"
echo "    rpc: $RPC"
echo "    forfeit: ${FORFEIT:0:4}…${FORFEIT: -4}"
echo "    lzEndpoint: ${ENDPOINT:0:4}…${ENDPOINT: -4}"

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
pnpm exec tsx scripts/assert-solana-ua-matches-deployer.ts >/dev/null
if [[ -n "$GATEWAY_AUTH" && "$GATEWAY_AUTH" != "$DEPLOYER_PUB" ]]; then
  echo "FAIL: SOLANA_GATEWAY_AUTHORITY must be empty or equal deployer pubkey (init signer)." >&2
  exit 1
fi
GATEWAY_AUTH="$DEPLOYER_PUB"
echo "    gatewayAuthority: $GATEWAY_AUTH (deployer)"
echo "    upgradeAuthority: $DEPLOYER_PUB (retained S4–S8)"

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

echo "==> assert upgrade authority = deployer (no handoff)"
for name in kar_passport kar_gateway mock_staking; do
  pid="$(cat "$WORK/${name}.program_id")"
  SHOW="$(solana program show "$pid" -u "$RPC" -k "$DEPLOYER_KP")"
  if ! echo "$SHOW" | grep -q "Authority: $DEPLOYER_PUB"; then
    echo "FAIL: $name upgrade authority read-back ≠ deployer" >&2
    echo "$SHOW" >&2
    exit 1
  fi
  if ! echo "$SHOW" | grep -q "Owner: BPFLoaderUpgradeab1e"; then
    echo "FAIL: $name not upgradeable loader" >&2
    echo "$SHOW" >&2
    exit 1
  fi
  echo "  $name ($pid) authority OK (deployer)"
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

deployer = os.environ["SVM_X3_DEPLOYER_PUBKEY"]
prior = {}
if pathlib.Path(path).exists():
    try:
        prior = json.loads(pathlib.Path(path).read_text())
    except Exception:
        prior = {}
programs = {}
# Preserve S5 staking/pass live rows across passport/gateway redeploy
for keep in ("kar_pro_staking", "kar_pro_pass"):
    row = (prior.get("programs") or {}).get(keep)
    if isinstance(row, dict) and row.get("programId"):
        programs[keep] = dict(row)
        programs[keep]["upgradeAuthority"] = row.get("upgradeAuthority") or deployer
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
        "upgradeAuthority": deployer,
    }

doc = {
    "cluster": "solana-devnet",
    "eid": 40168,
    "namespace": 2000040168,
    "rpcUrl": os.environ["SOLANA_RPC_URL"],
    "layerZeroEndpoint": os.environ["SOLANA_LZ_ENDPOINT"],
    "deployerPubkey": deployer,
    "gatewayConfigAuthority": os.environ["SVM_X3_GATEWAY_AUTH"],
    "forfeitRecipient": os.environ["SOLANA_FORFEIT_RECIPIENT"],
    "upgradeAuthority": deployer,
    "programs": programs,
    "slotAtEvidence": int(os.environ["SVM_X3_SLOT"]),
    "deployGitHead": os.environ["SVM_X3_GIT_HEAD"],
    "solanaCli": os.environ["SVM_X3_TOOLCHAIN"],
    "cargoBuildSbf": os.environ["SVM_X3_BUILD_SBF"],
    "commercialActive": False,
    "wired": False,
    "minStakePin": prior.get("minStakePin"),
    "note": "S5-recover-R5: new passport/gateway under deployer UA; prior Y5-frozen abandoned; no COMMERCIAL_ACTIVE",
    "abandonedPriorPrograms": {
        "reason": "Y5-frozen + X3: upgrade authority handed to unreachable BSuJ… via skip-signer (new-upgrade-authority without co-sign). Redeployed with new program ids under deployer UA.",
        "x3": {
            "kar_passport": "x8wSxkx5tW5yV9j7Lg8To5m34cj6Ji8aZ1GdKjHETrf",
            "kar_gateway": "ELNhPxSsCh2fdfndMNAjCtdmKDhcCsSezXzdgARNwWre",
            "mock_staking": "H4S6Gw1taHY5ux4adNavi4Rwi5vn9s7vEKNA4K3d6n89",
        },
        "y5_frozen": {
            "kar_passport": "FsDmjkrStitUPbh46y8JocGozNotF3EcT9rpDM1RDx1i",
            "kar_gateway": "EZNVaX7Xn4TER4uVxZpx8Xj87pdfTsXucMHtPJPEGbgr",
        },
    },
}
pathlib.Path(path).write_text(json.dumps(doc, indent=2) + "\n")
print(f"evidence → {path}")
PY

echo "==> deploy PASS"
echo "    passport: $PASSPORT_ID"
echo "    gateway:  $GATEWAY_ID"
echo "    staking:  $STAKING_ID (aux)"
echo "    upgradeAuthority: $DEPLOYER_PUB"
echo "    evidence: $EVIDENCE"
