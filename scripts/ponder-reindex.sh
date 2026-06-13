#!/usr/bin/env bash
# Run a clean Ponder reindex on the VPS Docker stack.
#
# Usage (from repo root on VPS):
#   ./scripts/ponder-reindex.sh
#
# For local Postgres, run the SQL directly:
#   psql "$DATABASE_URL" -f scripts/ponder-reindex.sql
#
# After this script completes, edit ponder.config.ts:
#   - Comment out startBlock: "latest"
#   - Uncomment startBlock: BASE_SEPOLIA_DEPLOY_START_BLOCK
# Then redeploy/restart Ponder.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$ROOT/scripts/ponder-reindex.sql"

echo "Stopping Ponder..."
docker compose -f "$ROOT/docker-compose.yml" stop ponder

echo "Truncating indexed tables and ponder_sync cache for chain 84532..."
docker compose -f "$ROOT/docker-compose.yml" exec -T postgres \
  psql -U ponder -d kargain_ponder -v ON_ERROR_STOP=1 < "$SQL"

echo ""
echo "Done. Next steps:"
echo "  1. In ponder.config.ts, swap START_BLOCK to 42800430 (comment/uncomment the two lines)."
echo "     If you keep START_BLOCK = \"latest\", skip step 2 — publicnode is fine."
echo "  2. Only for full backfill (42800430): set PONDER_RPC_URL_84532 to Alchemy or QuickNode."
echo "  3. docker compose up -d ponder"
echo "  4. Watch logs: docker compose logs -f ponder"
