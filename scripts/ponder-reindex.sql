-- Clean reindex after a contract redeploy or ponder.schema.ts change (Base Sepolia 84532).
--
-- When to run:
--   1. KarPassport and/or FixedPrice/Ascending consignment addresses changed
--   2. ponder.schema.ts changed (e.g. G1 trust fields, fuel/body/trans denorm)
--   3. You set PONDER_START_BLOCK_84532 from deployments/84532.json (indexFromBlock)
--
-- Full runbook: docs/indexer/OPERATIONS.md
-- Prerequisites:
--   - Stop Ponder before running (docker compose stop ponder)
--   - PONDER_RPC_URL_84532=https://sepolia.base.org on VPS (PublicNode without token → 403 on archive eth_getLogs)
--   - git pull; run pnpm ponder:config to verify stack + infra env
--
-- After this script:
--   1. git pull; pnpm ponder:config (addresses from lib/web3/sepolia-addresses.ts unless overridden)
--   2. Ensure .env: PONDER_RPC_URL_84532 + numeric PONDER_START_BLOCK_84532
--   3. docker compose up -d --force-recreate ponder
--   4. After sync: keep the same numeric start block (do not switch to latest on Ponder 0.16)
--
-- Schema: kargain (set via DATABASE_SCHEMA in docker-compose.yml)
--
-- Drops and recreates Ponder schemas (required when start block or contract
-- config changes — truncate alone leaves a stale build_id and Ponder will refuse to start).

DROP SCHEMA IF EXISTS kargain CASCADE;
DROP SCHEMA IF EXISTS ponder_sync CASCADE;
