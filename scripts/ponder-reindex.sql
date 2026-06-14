-- Clean reindex after a contract redeploy or ponder.schema.ts change (Base Sepolia 84532).
--
-- When to run:
--   1. KarPassport and/or MarketplaceEscrow addresses changed (Phase 5 v1.1 redeploy)
--   2. ponder.schema.ts changed (e.g. G1 trust fields, fuel/body/trans denorm)
--   3. You set PONDER_START_BLOCK_84532 from deployments/84532.json (indexFromBlock)
--
-- Full runbook: docs/VPS-PONDER-REINDEX.md
-- Prerequisites:
--   - Stop Ponder before running (docker compose stop ponder)
--   - For full backfill: use Alchemy/QuickNode RPC (publicnode may rate-limit eth_getLogs)
--   - Generate env: node --import tsx scripts/lib/print-ponder-env.ts
--
-- After this script:
--   1. Paste print-ponder-env output into server .env (PONDER_*_ADDRESS + PONDER_START_BLOCK_84532)
--   2. docker compose up -d ponder  (or pnpm ponder:start locally)
--   3. After sync completes → PONDER_START_BLOCK_84532=latest
--
-- Schema: kargain (set via DATABASE_SCHEMA in docker-compose.yml)
--
-- Drops and recreates Ponder schemas (required when start block or contract
-- config changes — truncate alone leaves a stale build_id and Ponder will refuse to start).

DROP SCHEMA IF EXISTS kargain CASCADE;
DROP SCHEMA IF EXISTS ponder_sync CASCADE;
