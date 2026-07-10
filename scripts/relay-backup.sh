#!/usr/bin/env bash
# Export strfry LMDB to a dated gzip backup; retain newest 8 files.
#
# Usage (from repo root on VPS):
#   ./scripts/relay-backup.sh
#
# Override backup directory:
#   KARGAIN_RELAY_BACKUP_DIR=/var/backups/kargain-relay ./scripts/relay-backup.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BACKUP_DIR="${KARGAIN_RELAY_BACKUP_DIR:-./backups/relay}"
RETAIN_COUNT=8

strfry_exec() {
  docker compose exec -T strfry --config /app/strfry.conf "$@"
}

mkdir -p "$BACKUP_DIR"

OUT="$BACKUP_DIR/relay-$(date +%Y%m%d).jsonl.gz"

echo "==> Exporting relay DB to ${OUT}…"
strfry_exec export | gzip > "$OUT"

echo "==> Pruning backups (keeping newest ${RETAIN_COUNT})…"
if compgen -G "${BACKUP_DIR}/relay-*.jsonl.gz" > /dev/null; then
  ls -1t "${BACKUP_DIR}"/relay-*.jsonl.gz | tail -n +$((RETAIN_COUNT + 1)) | xargs -r rm -f --
fi

size="$(du -h "$OUT" | awk '{print $1}')"
echo "==> Backup complete: ${OUT} (${size})"
