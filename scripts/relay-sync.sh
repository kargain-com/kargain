#!/usr/bin/env bash
# Sync Kargain relay events from public relays (author-filtered negentropy).
#
# Usage (from repo root on VPS):
#   ./scripts/relay-sync.sh
#
# Cron-safe: uses docker compose exec -T (no TTY). Idempotent — safe to re-run.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REMOTE_RELAYS=(
  wss://relay.damus.io
  wss://nos.lol
)
AUTHOR_CHUNK_SIZE=100

strfry_exec() {
  docker compose exec -T strfry /app/strfry --config /app/strfry.conf "$@"
}

build_authors_filter() {
  local filter='{"authors":['
  local first=1
  local pk
  for pk in "$@"; do
    if [[ $first -eq 1 ]]; then
      first=0
    else
      filter+=','
    fi
    filter+="\"${pk}\""
  done
  filter+=']}'
  printf '%s' "$filter"
}

echo "==> Scanning kind 0 events on own relay for author pubkeys…"

mapfile -t AUTHORS < <(
  docker compose exec -T strfry sh -c \
    '/app/strfry --config /app/strfry.conf scan "{\"kinds\":[0]}" | python3 -c "
import sys, json
seen = set()
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        pk = json.loads(line).get(\"pubkey\")
        if pk:
            seen.add(pk)
    except json.JSONDecodeError:
        pass
for pk in sorted(seen):
    print(pk)
"'
)

if [[ ${#AUTHORS[@]} -eq 0 ]] || [[ -z "${AUTHORS[0]:-}" ]]; then
  echo "no authors on relay yet, nothing to sync"
  exit 0
fi

echo "==> Found ${#AUTHORS[@]} author(s); syncing from ${#REMOTE_RELAYS[@]} remote relay(s)…"

total_chunks=$(( (${#AUTHORS[@]} + AUTHOR_CHUNK_SIZE - 1) / AUTHOR_CHUNK_SIZE ))

for remote in "${REMOTE_RELAYS[@]}"; do
  echo "==> Remote: ${remote}"
  chunk_idx=0
  offset=0
  while [[ $offset -lt ${#AUTHORS[@]} ]]; do
    chunk_idx=$((chunk_idx + 1))
    chunk=("${AUTHORS[@]:$offset:$AUTHOR_CHUNK_SIZE}")
    offset=$((offset + AUTHOR_CHUNK_SIZE))
    filter="$(build_authors_filter "${chunk[@]}")"

    echo "    chunk ${chunk_idx}/${total_chunks} (${#chunk[@]} authors)…"

    sync_output=""
    sync_status=0
    sync_output="$(strfry_exec sync "$remote" --dir down --filter "$filter" 2>&1)" || sync_status=$?

    while IFS= read -r line; do
      if [[ "$line" == *"added:"* ]]; then
        echo "    ${line}"
      fi
    done <<< "$sync_output"

    if [[ $sync_status -ne 0 ]]; then
      echo "WARNING: sync failed for ${remote} (chunk ${chunk_idx}/${total_chunks})" >&2
    fi
  done
done

echo "==> Relay sync finished."
