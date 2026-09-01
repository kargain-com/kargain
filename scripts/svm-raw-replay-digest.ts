#!/usr/bin/env node
/**
 * Chain-free rebuild digest for kargain_svm_raw.structured_payload.
 */

import { createRequire } from "node:module";

import pg from "pg";

import { replayDigestFromPool } from "../lib/svm/raw-replay-digest.js";

const require = createRequire(import.meta.url);
try {
  require("dotenv").config({ path: ".env.local" });
} catch {
  /* optional */
}

async function main(): Promise<void> {
  if (process.env.SVM_INGEST_RPC_URL?.trim()) {
    throw new Error(
      "SVM_INGEST_RPC_URL must be unset for replay digest (chain access removed)",
    );
  }

  const databaseUrl =
    process.env.SVM_INGEST_DATABASE_URL?.trim() ??
    process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("SVM_INGEST_DATABASE_URL or DATABASE_URL required");
  }

  const nsRaw = process.env.SVM_INGEST_NAMESPACE?.trim();
  const namespace = nsRaw ? Number(nsRaw) : undefined;

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const { digest, rowCount } = await replayDigestFromPool(pool, namespace);
    console.log(JSON.stringify({ digest, rowCount, namespace: namespace ?? "all" }));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
