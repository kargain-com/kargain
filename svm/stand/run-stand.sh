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
#
# Isolation: refuses if 8899/8900 already accepting, or if Hardhat :8545 is up
# unless KARGAIN_SVM_STAND_EVM=1. Residual: foreign Node workers that do not hold
# those ports cannot be detected from port probes alone — run the stand alone.
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

# Stems overridden via KARGAIN_SVM_STAND_SO_OVERRIDE are not rebuilt (mixed-version).
# Bash 3.2: scan env each time (same syntax as stand-artifact-bindings.ts).
stand_so_override_has() {
  local want="$1"
  local raw="${KARGAIN_SVM_STAND_SO_OVERRIDE:-}"
  [[ -z "$raw" ]] && return 1
  local OLDIFS="$IFS"
  IFS=','
  # shellcheck disable=SC2086
  set -- $raw
  IFS="$OLDIFS"
  local part stem
  for part in "$@"; do
    part="${part#"${part%%[![:space:]]*}"}"
    part="${part%"${part##*[![:space:]]}"}"
    [[ -z "$part" || "$part" != *=* ]] && continue
    stem="${part%%=*}"
    stem="${stem#"${stem%%[![:space:]]*}"}"
    stem="${stem%"${stem##*[![:space:]]}"}"
    [[ "$stem" == "$want" ]] && return 0
  done
  return 1
}

build_arch() {
  local arch="$1"
  local purpose
  if [[ "$arch" == "v3" ]]; then
    purpose=upgradeable_ship
  else
    purpose=stand_preload
  fi
  echo "==> build SBF programs (purpose=$purpose / --arch $arch via svm-deploy-artifact)"
  local prog so_stem
  local -a dirs=()
  for prog in mock-endpoint kar-passport kar-gateway mock-staking kar-pro-staking kar-pro-pass money-harness consignment-harness kar-fixed-price kar-ascending; do
    so_stem="${prog//-/_}"
    if stand_so_override_has "$so_stem"; then
      echo "    skip $prog (KARGAIN_SVM_STAND_SO_OVERRIDE=$so_stem)"
      continue
    fi
    dirs+=("$prog")
  done
  if [[ ${#dirs[@]} -eq 0 ]]; then
    echo "    (all stems overridden — nothing to build)"
    return 0
  fi
  local joined
  joined="$(IFS=,; echo "${dirs[*]}")"
  pnpm svm:build-artifacts --purpose "$purpose" --programs "$joined"
}

assert_isolation() {
  echo "==> stand isolation preflight"
  pnpm exec tsx svm/stand/wait-stand-ready.ts
}

wait_validator() {
  local val_pid="$1"
  local val_log="$2"
  echo "    waiting for rpc:8899 + websocket:8900 …"
  if ! pnpm exec tsx svm/stand/wait-stand-ready.ts --skip-isolation; then
    echo "validator not ready — log:" >&2
    cat "$val_log" >&2
    exit 1
  fi
  if ! kill -0 "$val_pid" 2>/dev/null; then
    echo "validator exited early — log:" >&2
    cat "$val_log" >&2
    exit 1
  fi
}

run_live() {
  local load="$1"   # preload | upgradeable
  local arch
  if [[ "$load" == "upgradeable" ]]; then
    arch=v3
  else
    arch=v0
  fi

  assert_isolation
  build_arch "$arch"

  local deploy_dir="$ROOT/svm/target/deploy"
  if [[ "$load" == "upgradeable" ]]; then
    deploy_dir="$ROOT/svm/target/deploy-v3"
  fi
  export KARGAIN_SVM_STAND_DEPLOY_DIR="$deploy_dir"

  echo "==> start stand validator (load=$load deployDir=$deploy_dir)"
  VAL_LOG="$(mktemp -t kargain-svm-stand.XXXXXX.log)"
  KARGAIN_SVM_STAND_LOAD="$load" KARGAIN_SVM_STAND_DEPLOY_DIR="$deploy_dir" ./svm/stand/start-validator.sh >"$VAL_LOG" 2>&1 &
  VAL_PID=$!
  cleanup() {
    kill "$VAL_PID" 2>/dev/null || true
    wait "$VAL_PID" 2>/dev/null || true
  }
  trap cleanup EXIT

  wait_validator "$VAL_PID" "$VAL_LOG"

  if [[ "$load" == "upgradeable" ]]; then
    echo "==> deploy stand programs via upgradeable loader"
    KARGAIN_SVM_STAND_DEPLOY_DIR="$deploy_dir" ./svm/stand/deploy-stand-programs.sh
  fi

  echo "==> pnpm test:svm-stand (LIVE=1 load=$load — Core CPI required)"
  KARGAIN_SVM_STAND_LIVE=1 KARGAIN_SVM_STAND_LOAD="$load" KARGAIN_SVM_STAND_DEPLOY_DIR="$deploy_dir" pnpm test:svm-stand

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
