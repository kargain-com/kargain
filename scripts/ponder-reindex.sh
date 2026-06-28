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
#   git pull && pnpm ponder:config   # verify stack + infra env
#   docker compose up -d --force-recreate ponder

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
echo "  1. git pull origin master"
echo "  2. pnpm ponder:config   (verify addresses + PONDER_START_BLOCK_84532)"
echo "  3. Ensure server .env has PONDER_RPC_URL_84532=https://sepolia.base.org"
echo "  4. docker compose up -d --force-recreate ponder"
echo "  5. After sync: keep the same numeric start block (do NOT set latest on Ponder 0.16)"
echo "  6. Watch logs: docker compose logs -f ponder"
