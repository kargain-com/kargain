-- Clean reindex after a contract redeploy on Base Sepolia (chain 84532).
--
-- When to run:
--   1. Contract addresses changed in ponder.config.ts
--   2. You switched START_BLOCK to 42800430 in ponder.config.ts
--
-- Prerequisites:
--   - Stop Ponder before running (docker compose stop ponder)
--   - Only if switching START_BLOCK to 42800430: use Alchemy/QuickNode for backfill.
--     With START_BLOCK = "latest", keep publicnode (https://base-sepolia.publicnode.com).
--
-- After this script:
--   1. In ponder.config.ts, swap START_BLOCK to 42800430 (comment/uncomment the two lines).
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
