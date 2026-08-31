#!/usr/bin/env bash
# Orchestrate the local cross-VM stand gate.
#
# Host-only (default — CI-safe without validator):
#   ./svm/stand/run-stand.sh
#
# Live Core CPI via --bpf-program preload (default live):
#   ./svm/stand/run-stand.sh --live
#
# Live Core CPI via upgradeable-loader deploy (S4a Devnet-shaped):
#   ./svm/stand/run-stand.sh --live-upgradeable
#
# Both live load paths sequentially:
#   ./svm/stand/run-stand.sh --live-both
#
# Assumes Agave CLI on PATH (or ~/.local/share/solana/install/active_release/bin).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
export NODE_PATH="${ROOT}/svm/lab/node_modules${NODE_PATH:+:$NODE_PATH}"

MODE=host
case "${1:-}" in
  --live) MODE=preload ;;
  --live-upgradeable) MODE=upgradeable ;;
  --live-both) MODE=both ;;
  "")
    if [[ "${KARGAIN_SVM_STAND_LIVE:-}" == "1" ]]; then
      if [[ "${KARGAIN_SVM_STAND_LOAD:-}" == "upgradeable" ]]; then
        MODE=upgradeable
      else
        MODE=preload
      fi
    fi
    ;;
  *)
    echo "usage: $0 [--live|--live-upgradeable|--live-both]" >&2
    exit 1
    ;;
esac

build_arch() {
  local arch="$1"
  echo "==> build SBF programs (--arch $arch)"
  for prog in mock-endpoint kar-passport kar-gateway mock-staking kar-pro-staking kar-pro-pass money-harness consignment-harness kar-fixed-price; do
    echo "    cargo-build-sbf --arch $arch ($prog)"
    (cd "svm/programs/$prog" && cargo-build-sbf --arch "$arch")
  done
}

wait_validator() {
  local val_pid="$1"
  local val_log="$2"
  echo "    waiting for 127.0.0.1:8899 …"
  for i in $(seq 1 90); do
    if curl -sf http://127.0.0.1:8899 -X POST -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth","params":[]}' \
      | grep -q '"result":"ok"'; then
      echo "    validator ready"
      return 0
    fi
    if ! kill -0 "$val_pid" 2>/dev/null; then
      echo "validator exited early — log:" >&2
      cat "$val_log" >&2
      exit 1
    fi
    if [[ "$i" -eq 90 ]]; then
      echo "validator not healthy after 90s — log:" >&2
      cat "$val_log" >&2
      exit 1
    fi
    sleep 1
  done
}

run_live() {
  local load="$1"   # preload | upgradeable
  local arch
  if [[ "$load" == "upgradeable" ]]; then
    arch=v3
  else
    arch=v0
  fi

  build_arch "$arch"

  echo "==> start stand validator (load=$load)"
  VAL_LOG="$(mktemp -t kargain-svm-stand.XXXXXX.log)"
  KARGAIN_SVM_STAND_LOAD="$load" ./svm/stand/start-validator.sh >"$VAL_LOG" 2>&1 &
  VAL_PID=$!
  cleanup() {
    kill "$VAL_PID" 2>/dev/null || true
    wait "$VAL_PID" 2>/dev/null || true
  }
  trap cleanup EXIT

  wait_validator "$VAL_PID" "$VAL_LOG"

  if [[ "$load" == "upgradeable" ]]; then
    echo "==> deploy stand programs via upgradeable loader"
    ./svm/stand/deploy-stand-programs.sh
  fi

  echo "==> pnpm test:svm-stand (LIVE=1 load=$load — Core CPI required)"
  KARGAIN_SVM_STAND_LIVE=1 KARGAIN_SVM_STAND_LOAD="$load" pnpm test:svm-stand

  cleanup
  trap - EXIT
}

echo "==> cargo test (svm workspace)"
(cd svm && cargo test)

if [[ "$MODE" == "host" ]]; then
  # Host path still needs some .so for imports that check file presence? host-sim does not.
  # Keep a cheap v0 build so artifacts exist for optional local probes.
  build_arch v0
  echo "==> pnpm test:svm-stand (host only; live skipped)"
  pnpm test:svm-stand
  echo "    Tip: ./svm/stand/run-stand.sh --live | --live-upgradeable | --live-both"
elif [[ "$MODE" == "both" ]]; then
  run_live preload
  run_live upgradeable
else
  run_live "$MODE"
fi

echo "==> stand scripts done (mode=$MODE)."
