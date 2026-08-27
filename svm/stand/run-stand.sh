#!/usr/bin/env bash
# Orchestrate the local cross-VM stand gate.
#
# Host-only (default — CI-safe without validator):
#   ./svm/stand/run-stand.sh
#
# Full S3 live gate (builds BPF, starts validator, requires Core CPI PASS):
#   ./svm/stand/run-stand.sh --live
#
# Assumes Agave CLI on PATH (or ~/.local/share/solana/install/active_release/bin).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
export NODE_PATH="${ROOT}/svm/lab/node_modules${NODE_PATH:+:$NODE_PATH}"

LIVE=0
if [[ "${1:-}" == "--live" ]] || [[ "${KARGAIN_SVM_STAND_LIVE:-}" == "1" ]]; then
  LIVE=1
fi

echo "==> cargo test (svm workspace)"
(cd svm && cargo test)

echo "==> build SBF programs (--arch v0 for Agave 4.2 --bpf-program load)"
for prog in mock-endpoint kar-passport kar-gateway mock-staking; do
  echo "    cargo-build-sbf --arch v0 ($prog)"
  (cd "svm/programs/$prog" && cargo-build-sbf --arch v0)
done

if [[ "$LIVE" -eq 1 ]]; then
  echo "==> start stand validator (preload Core + programs via --bpf-program)"
  VAL_LOG="$(mktemp -t kargain-svm-stand.XXXXXX.log)"
  ./svm/stand/start-validator.sh >"$VAL_LOG" 2>&1 &
  VAL_PID=$!
  cleanup() {
    kill "$VAL_PID" 2>/dev/null || true
    wait "$VAL_PID" 2>/dev/null || true
  }
  trap cleanup EXIT

  echo "    waiting for 127.0.0.1:8899 …"
  for i in $(seq 1 60); do
    if curl -sf http://127.0.0.1:8899 -X POST -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth","params":[]}' \
      | grep -q '"result":"ok"'; then
      echo "    validator ready"
      break
    fi
    if ! kill -0 "$VAL_PID" 2>/dev/null; then
      echo "validator exited early — log:" >&2
      cat "$VAL_LOG" >&2
      exit 1
    fi
    if [[ "$i" -eq 60 ]]; then
      echo "validator not healthy after 60s — log:" >&2
      cat "$VAL_LOG" >&2
      exit 1
    fi
    sleep 1
  done

  echo "==> pnpm test:svm-stand (LIVE=1 — Core CPI required)"
  KARGAIN_SVM_STAND_LIVE=1 pnpm test:svm-stand
else
  echo "==> pnpm test:svm-stand (host only; live skipped)"
  pnpm test:svm-stand
  echo "    Tip: ./svm/stand/run-stand.sh --live  for Core CPI gate"
fi

echo "==> stand scripts done."
