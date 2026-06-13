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

BEGIN;

-- App tables (indexed passport / marketplace / verifier state)
TRUNCATE TABLE kargain.passport CASCADE;
TRUNCATE TABLE kargain.passport_record CASCADE;
TRUNCATE TABLE kargain.marketplace_listing CASCADE;
TRUNCATE TABLE kargain.marketplace_sale CASCADE;
TRUNCATE TABLE kargain.verifier CASCADE;

-- Ponder internal RPC/sync cache (single-chain app — safe to wipe entirely).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'ponder_sync'
  LOOP
    EXECUTE format('TRUNCATE TABLE ponder_sync.%I CASCADE', r.tablename);
  END LOOP;
END $$;

COMMIT;
