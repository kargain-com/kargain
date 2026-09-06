/**
 * svm-ingest service entry — sole runtime writer to kargain_svm_raw.
 */

import { createRequire } from "node:module";

import pg from "pg";

import {
  assertSvmCommercialEvidence,
  followedProgramsFromEvidence,
  resolveCatchupMaxLagSlots,
  resolveIngestNamespace,
  resolveIngestStartSlot,
} from "../../lib/svm/ingest-config.js";
import { loadSvmDevnetEvidence } from "../../scripts/lib/load-deployment.js";
import { applySvmRawSchema, createSvmRawWriter } from "../lib/svm-raw-writer.js";
import {
  applySvmProjectionSchema,
  createSvmProjectionWriter,
} from "../lib/svm-projection-writer.js";
import { createIngestLoop } from "./ingest-loop.js";
import { createProjectionProjector } from "./projection-projector.js";
import { createSvmIngestHealthServer } from "./http-health.js";
import { createSolanaRpcClient } from "./rpc-client.js";

const require = createRequire(import.meta.url);
try {
  require("dotenv").config({ path: ".env.local" });
} catch {
  /* optional */
}

async function main(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
  if (!rpcUrl) {
    throw new Error("SOLANA_RPC_URL required for svm-ingest");
  }
  const databaseUrl =
    process.env.SVM_INGEST_DATABASE_URL?.trim() ??
    process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("SVM_INGEST_DATABASE_URL or DATABASE_URL required");
  }

  const eid = Number(process.env.SVM_INGEST_EID?.trim() ?? "40168");
  const evidence = loadSvmDevnetEvidence(eid);
  if (!evidence) {
    throw new Error(`Missing deploy evidence deployments/svm-${eid}.json`);
  }

  assertSvmCommercialEvidence(evidence);
  const namespace = resolveIngestNamespace(evidence);
  const startSlot = resolveIngestStartSlot(evidence);
  const followedPrograms = followedProgramsFromEvidence(evidence);

  const pool = new pg.Pool({ connectionString: databaseUrl });
  await applySvmRawSchema(pool);
  await applySvmProjectionSchema(pool);
  const writer = createSvmRawWriter(pool);
  const projectionWriter = createSvmProjectionWriter(pool);
  const projector = createProjectionProjector(pool, projectionWriter);
  const rpc = createSolanaRpcClient(rpcUrl);
  const loop = createIngestLoop({
    namespace,
    startSlot,
    maxLagSlots: resolveCatchupMaxLagSlots(),
    followedPrograms,
    writer,
    rpc,
    projector,
  });

  await loop.initCursor();
  await loop.catchUpToHead();

  const port = Number(process.env.SVM_INGEST_PORT?.trim() ?? "42100");
  const health = createSvmIngestHealthServer({
    port,
    getSnapshot: () => {
      const s = loop.getState();
      return {
        ready: loop.isReady(),
        bootstrapState: s.bootstrapState,
        incident: s.catchupIncident,
        lagSlots: s.lagSlots,
        lastContiguousSlot: s.lastContiguousSlot,
      };
    },
  });

  const pollMs = Number(process.env.SVM_INGEST_POLL_MS?.trim() ?? "2000");
  const timer = setInterval(() => {
    void loop.followOnce().catch((err) => {
      console.error("svm-ingest follow error:", err);
    });
  }, pollMs);

  const shutdown = async () => {
    clearInterval(timer);
    await health.close();
    await pool.end();
  };
  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

  console.log(
    `svm-ingest listening health=:${port} namespace=${namespace} startSlot=${startSlot} programs=${followedPrograms.length}`,
  );
}

/** Direct CLI only — never run when Ponder's indexer graph loads this file under `src/`. */
function isExecutedAsCli(): boolean {
  const entry = process.argv[1];
  if (entry == null) return false;
  return /svm-ingest[/\\]main\.(ts|js|mjs|cjs)$/.test(entry);
}

if (isExecutedAsCli()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
