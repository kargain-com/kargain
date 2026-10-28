/**
 * svm-ingest service entry — sole runtime writer to kargain_svm_raw.
 * Boot from COMMERCIAL_ACTIVE only — no deployments/ evidence at runtime.
 */

import { createRequire } from "node:module";

import pg from "pg";

import { buildSvmIngestRuntime } from "../../lib/svm/ingest-config.js";
import { applySvmRawSchema, createSvmRawWriter } from "../lib/svm-raw-writer.js";
import {
  applySvmProjectionSchema,
  createSvmProjectionWriter,
} from "../lib/svm-projection-writer.js";
import { runFollowLoop } from "./follow-loop.js";
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
  const rt = buildSvmIngestRuntime();

  const pool = new pg.Pool({ connectionString: rt.databaseUrl });
  await applySvmRawSchema(pool);
  await applySvmProjectionSchema(pool);
  const writer = createSvmRawWriter(pool);
  const projectionWriter = createSvmProjectionWriter(pool);
  const projector = createProjectionProjector(pool, projectionWriter);
  const rpc = createSolanaRpcClient(rt.rpcUrl, {
    maxRps: rt.maxRps,
  });
  const loop = createIngestLoop({
    namespace: rt.namespace,
    startSlot: rt.startSlot,
    maxLagSlots: rt.maxLagSlots,
    followedPrograms: rt.followedPrograms,
    writer,
    rpc,
    projector,
  });

  await loop.initCursor();
  await loop.catchUpToHead();

  const health = createSvmIngestHealthServer({
    port: rt.port,
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
  const followAbort = new AbortController();
  const followDone = runFollowLoop({
    followOnce: async () => {
      // Bootstrap incomplete → retry catch-up; live → watermark discovery.
      if (loop.getState().bootstrapState) {
        await loop.catchUpToHead();
      } else {
        await loop.followOnce();
      }
    },
    pollMs,
    signal: followAbort.signal,
    onError: (err) => {
      console.error("svm-ingest follow error:", err);
    },
  });

  const shutdown = async () => {
    followAbort.abort();
    await followDone;
    await health.close();
    await pool.end();
  };
  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

  console.log(
    `svm-ingest listening health=:${rt.port} namespace=${rt.namespace} startSlot=${rt.startSlot} programs=${rt.followedPrograms.length} maxRps=${rt.maxRps} discovery=signatures`,
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
