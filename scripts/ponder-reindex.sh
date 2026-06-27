#!/usr/bin/env bash
# Run a clean Ponder reindex on the VPS Docker stack.
#
# Usage (from repo root on VPS):
#   ./scripts/ponder-reindex.sh
#
# For local Postgres, run the SQL directly:
#   psql "$DATABASE_URL" -f scripts/ponder-reindex.sql
#
# After this script completes:
#   eval "$(node --import tsx scripts/lib/print-ponder-env.ts)"   # if deployments/84532.json present
#   # Paste output into server .env, then restart Ponder.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$ROOT/scripts/ponder-reindex.sql"

echo "Stopping Ponder..."
docker compose -f "$ROOT/docker-compose.yml" stop ponder

echo "Truncating indexed tables and ponder_sync cache..."
docker compose -f "$ROOT/docker-compose.yml" exec -T postgres \
  psql -U ponder -d kargain_ponder -v ON_ERROR_STOP=1 < "$SQL"

echo ""
echo "Done. Next steps:"
echo "  1. node --import tsx scripts/lib/print-ponder-env.ts"
echo "  2. Paste exports into server .env (PONDER_*_ADDRESS, PONDER_START_BLOCK_84532=<indexFromBlock or checkpoint>)"
echo "  3. Set PONDER_RPC_URL_84532=https://sepolia.base.org (see docs/indexer/OPERATIONS.md)"
echo "  4. docker compose up -d --force-recreate ponder"
echo "  5. After sync: keep the same numeric start block (do NOT set latest on Ponder 0.16)"
echo "  6. Watch logs: docker compose logs -f ponder"
