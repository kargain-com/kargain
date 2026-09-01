#!/usr/bin/env node
/**
 * Chain-free rebuild digest for kargain_svm_projection.
 */
import pg from "pg";

import { projectionReplayDigestFromPool } from "../lib/svm/projection-replay-digest.js";
import { rebuildProjectionFromRaw } from "../src/svm-ingest/projection-rebuild.js";

async function main(): Promise<void> {
  if (process.env.SVM_INGEST_RPC_URL?.trim()) {
    throw new Error("SVM_INGEST_RPC_URL must be unset for chain-free projection replay digest");
  }

  const databaseUrl =
    process.env.SVM_INGEST_DATABASE_URL?.trim() ??
    process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("SVM_INGEST_DATABASE_URL or DATABASE_URL required");
  }

  const namespace = process.env.SVM_INGEST_NAMESPACE
    ? Number(process.env.SVM_INGEST_NAMESPACE)
    : undefined;

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await rebuildProjectionFromRaw(pool, namespace);
    const { digest, recordCount, uriCount } = await projectionReplayDigestFromPool(
      pool,
      namespace,
    );
    console.log(
      JSON.stringify({ digest, recordCount, uriCount, namespace: namespace ?? "all" }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
