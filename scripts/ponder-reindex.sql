-- Clean reindex after a contract redeploy on Base Sepolia (chain 84532).
--
-- When to run:
--   1. Contract addresses changed in ponder.config.ts
--   2. You set PONDER_START_BLOCK=42800430 in server .env
--
-- Prerequisites:
--   - Stop Ponder before running (docker compose stop ponder)
--   - Only if PONDER_START_BLOCK=42800430: use Alchemy/QuickNode for backfill.
--     With PONDER_START_BLOCK unset or "latest", keep publicnode.
--
-- After this script:
--   1. Set PONDER_START_BLOCK=42800430 in server .env (or omit for "latest").
--   2. docker compose up -d ponder  (or pnpm ponder:start locally)
--
-- Schema: kargain (set via DATABASE_SCHEMA in docker-compose.yml)
--
-- Drops and recreates Ponder schemas (required when PONDER_START_BLOCK or contract
-- config changes — truncate alone leaves a stale build_id and Ponder will refuse to start).

DROP SCHEMA IF EXISTS kargain CASCADE;
DROP SCHEMA IF EXISTS ponder_sync CASCADE;
