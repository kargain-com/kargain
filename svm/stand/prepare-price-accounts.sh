#!/usr/bin/env bash
# Prepare receiver-owned PriceUpdateV2 accounts for the local stand validator.
# Preferred: clone the Devnet sponsored SOL/USD account.
# Fallback: write --account JSON from committed fixtures (same receiver owner).
# Never uses a Kargain program to write price bytes.
set -euo pipefail

STAND_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$STAND_DIR/../.." && pwd)"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

SRC_JSON="$STAND_DIR/stand-price-source.json"
OUT_DIR="${1:?usage: prepare-price-accounts.sh <account-dir> [boot-json]}"
BOOT_JSON="${2:-/tmp/kargain-svm-stand-price-boot.json}"

RECEIVER="$(python3 -c "import json; print(json.load(open('$SRC_JSON'))['receiverProgramId'])")"
FEED_HEX="$(python3 -c "import json; print(json.load(open('$SRC_JSON'))['feedIdHex'])")"
FRESH_ADDR="$(python3 -c "import json; print(json.load(open('$SRC_JSON'))['accounts']['fresh']['address'])")"
STALE_ADDR="$(python3 -c "import json; print(json.load(open('$SRC_JSON'))['accounts']['stale']['address'])")"
WIDE_ADDR="$(python3 -c "import json; print(json.load(open('$SRC_JSON'))['accounts']['wide']['address'])")"
BAD_ADDR="$(python3 -c "import json; print(json.load(open('$SRC_JSON'))['accounts']['bad']['address'])")"
FIXTURES="$ROOT/$(python3 -c "import json; print(json.load(open('$SRC_JSON'))['fixturesDir'])")"
FRESH_BIN="$(python3 -c "import json; print(json.load(open('$SRC_JSON'))['freshFixtureBin'])")"
DEVNET_RPC="${SOLANA_RPC_URL:-$(python3 -c "import json; print(json.load(open('$SRC_JSON'))['devnetRpcDefault'])")}"
PUBLISH_OFF="$(python3 -c "import json; print(json.load(open('$SRC_JSON'))['publishTimeOffset'])")"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.json

PATH_TAKEN=fixture

write_account_json() {
  local pubkey="$1"
  local bin_path="$2"
  local out="$3"
  local publish_unix="${4:-}"
  python3 - "$pubkey" "$bin_path" "$out" "$RECEIVER" "$PUBLISH_OFF" "$publish_unix" <<'PY'
import base64, json, struct, sys, time
pubkey, bin_path, out, owner, off_s, pub_s = sys.argv[1:7]
off = int(off_s)
data = bytearray(open(bin_path, "rb").read())
if len(data) < 134:
    raise SystemExit(f"fixture too short: {bin_path} len={len(data)}")
if pub_s:
    publish = int(pub_s)
    struct.pack_into("<q", data, off, publish)
lamports = 1_000_000_000
payload = {
    "pubkey": pubkey,
    "account": {
        "lamports": lamports,
        "data": [base64.b64encode(bytes(data)).decode("ascii"), "base64"],
        "owner": owner,
        "executable": False,
        "rentEpoch": 0,
        "space": len(data),
    },
}
open(out, "w").write(json.dumps(payload, indent=2) + "\n")
PY
}

# Preferred: dump live Devnet fresh account (receiver-owned).
CLONE_TMP="$(mktemp)"
if timeout 25 solana account "$FRESH_ADDR" -u "$DEVNET_RPC" --output json -o "$CLONE_TMP" >/dev/null 2>&1; then
  # Verify owner matches receiver before accepting.
  OWNER_GOT="$(python3 -c "import json; print(json.load(open('$CLONE_TMP'))['account']['owner'])")"
  if [[ "$OWNER_GOT" == "$RECEIVER" ]]; then
    cp "$CLONE_TMP" "$OUT_DIR/fresh.json"
    PATH_TAKEN=clone
  else
    echo "stand price: clone owner mismatch ($OWNER_GOT ≠ $RECEIVER) — using fixture" >&2
  fi
else
  echo "stand price: Devnet clone unavailable — using fixture fallback" >&2
fi
rm -f "$CLONE_TMP"

NOW="$(date +%s)"
if [[ "$PATH_TAKEN" != "clone" ]]; then
  # Fresh fixture: patch publish_time to now-30 so admit is deterministic offline.
  write_account_json "$FRESH_ADDR" "$FIXTURES/$FRESH_BIN" "$OUT_DIR/fresh.json" "$((NOW - 30))"
fi

# Decoder negatives: always fixture-backed, receiver-owned, distinct addresses.
write_account_json "$STALE_ADDR" "$FIXTURES/lab-stale.bin" "$OUT_DIR/stale.json" ""
write_account_json "$WIDE_ADDR" "$FIXTURES/lab-wide_conf.bin" "$OUT_DIR/wide.json" "$NOW"
write_account_json "$BAD_ADDR" "$FIXTURES/lab-non_positive.bin" "$OUT_DIR/bad.json" "$NOW"

python3 - "$BOOT_JSON" "$PATH_TAKEN" "$RECEIVER" "$FEED_HEX" \
  "$FRESH_ADDR" "$STALE_ADDR" "$WIDE_ADDR" "$BAD_ADDR" <<'PY'
import json, sys
boot, path, receiver, feed, fresh, stale, wide, bad = sys.argv[1:9]
payload = {
    "path": path,
    "receiverProgramId": receiver,
    "feedIdHex": feed,
    "accounts": {
        "fresh": fresh,
        "stale": stale,
        "wide": wide,
        "bad": bad,
    },
}
open(boot, "w").write(json.dumps(payload, indent=2) + "\n")
print(f"stand price path={path} receiver={receiver} fresh={fresh}", flush=True)
PY
