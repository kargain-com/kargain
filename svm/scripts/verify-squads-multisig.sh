#!/usr/bin/env bash
# S4b X1 — prove a Squads V4 multisig exists on Solana Devnet before any
# upgrade-authority handoff. Fail-closed: missing account, wrong owner, or
# undecodable Multisig → exit 1 (stop deploy / wire).
#
# Usage:
#   ./svm/scripts/verify-squads-multisig.sh [multisig_pubkey]
# Env:
#   SVM_SQUADS_MULTISIG   default pubkey if argv omitted
#   SVM_RPC_URL           default https://api.devnet.solana.com
#
# Program id (mainnet = Devnet): SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
set -euo pipefail

export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

SQUADS_V4_PROGRAM_ID="SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"
# Founder-supplied S4b candidate (2026-08-29). Override via argv / env.
DEFAULT_MULTISIG="BSuJ2aG3nxPyMnP2hxzkBTYc71k2R9Sf87PcnrzAXDaG"
MULTISIG="${1:-${SVM_SQUADS_MULTISIG:-$DEFAULT_MULTISIG}}"
RPC="${SVM_RPC_URL:-https://api.devnet.solana.com}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}
need_cmd solana
need_cmd python3

echo "==> Squads V4 verify"
echo "    rpc:      $RPC"
echo "    multisig: $MULTISIG"
echo "    expect owner: $SQUADS_V4_PROGRAM_ID"

ACCOUNT_JSON="$(mktemp)"
trap 'rm -f "$ACCOUNT_JSON"' EXIT

set +e
solana account "$MULTISIG" --url "$RPC" --output json >"$ACCOUNT_JSON" 2>/tmp/kargain-squads-verify.err
RC=$?
set -e
if [[ $RC -ne 0 ]]; then
  echo "FAIL: account not found or RPC error for $MULTISIG" >&2
  cat /tmp/kargain-squads-verify.err >&2 || true
  echo "STOP: not a live Squads V4 multisig — do not deploy, do not set-upgrade-authority." >&2
  exit 1
fi

python3 - "$ACCOUNT_JSON" "$SQUADS_V4_PROGRAM_ID" "$MULTISIG" <<'PY'
import base64, json, struct, sys

path, expect_owner, address = sys.argv[1], sys.argv[2], sys.argv[3]
raw = json.load(open(path))
# solana CLI wraps as {"account": {...}} or flat
acct = raw.get("account", raw)
owner = acct.get("owner")
if owner != expect_owner:
    print(f"FAIL: owner={owner!r} expected Squads V4 {expect_owner!r}", file=sys.stderr)
    print("STOP: not owned by Squads V4 — do not deploy.", file=sys.stderr)
    sys.exit(1)

data_field = acct["data"]
if isinstance(data_field, list):
    blob = base64.b64decode(data_field[0])
elif isinstance(data_field, str):
    blob = base64.b64decode(data_field)
else:
    print("FAIL: unexpected data encoding", file=sys.stderr)
    sys.exit(1)

# Anchor Multisig (beet / @sqds/multisig):
# disc(8) + createKey(32) + configAuthority(32) + threshold(u16) + timeLock(u32)
# + transactionIndex(u64) + staleTransactionIndex(u64)
# + rentCollector Option<Pubkey> + bump(u8) + members Vec<{key:32, permissions:u8}>
if len(blob) < 8 + 32 + 32 + 2 + 4 + 8 + 8 + 1 + 1 + 4:
    print(f"FAIL: account too short ({len(blob)} bytes) for Multisig", file=sys.stderr)
    sys.exit(1)

off = 8  # skip discriminator
create_key = blob[off : off + 32]; off += 32
config_authority = blob[off : off + 32]; off += 32
(threshold,) = struct.unpack_from("<H", blob, off); off += 2
(time_lock,) = struct.unpack_from("<I", blob, off); off += 4
(tx_index,) = struct.unpack_from("<Q", blob, off); off += 8
(stale_index,) = struct.unpack_from("<Q", blob, off); off += 8
opt = blob[off]; off += 1
if opt == 1:
    off += 32  # rentCollector
elif opt != 0:
    print(f"FAIL: bad rentCollector option tag {opt}", file=sys.stderr)
    sys.exit(1)
bump = blob[off]; off += 1
(n_members,) = struct.unpack_from("<I", blob, off); off += 4
if n_members > 64 or off + n_members * 33 > len(blob):
    print(f"FAIL: member count {n_members} undecodable at len={len(blob)}", file=sys.stderr)
    sys.exit(1)

ALPHABET = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

def b58(data: bytes) -> str:
    n = int.from_bytes(data, "big")
    out = bytearray()
    while n:
        n, r = divmod(n, 58)
        out.append(ALPHABET[r])
    pad = 0
    for b in data:
        if b == 0:
            pad += 1
        else:
            break
    return (ALPHABET[0:1] * pad + bytes(reversed(out))).decode()

members = []
for _ in range(n_members):
    key = blob[off : off + 32]
    perm = blob[off + 32]
    off += 33
    members.append((b58(key), perm))

if threshold < 1 or threshold > n_members:
    print(
        f"FAIL: threshold={threshold} not in 1..{n_members} (not a usable multisig)",
        file=sys.stderr,
    )
    sys.exit(1)

print("OK: Squads V4 Multisig")
print(f"    address:          {address}")
print(f"    owner:            {owner}")
print(f"    create_key:       {b58(create_key)}")
print(f"    config_authority: {b58(config_authority)}")
print(f"    threshold:        {threshold}")
print(f"    time_lock_s:      {time_lock}")
print(f"    tx_index:         {tx_index}")
print(f"    stale_tx_index:   {stale_index}")
print(f"    bump:             {bump}")
print(f"    members ({n_members}):")
for key, perm in members:
    print(f"      - {key}  permissions=0x{perm:02x}")
PY
