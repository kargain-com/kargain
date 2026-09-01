#!/usr/bin/env -S node --import tsx
/**
 * S7a event + CU budget measurement on local validator.
 *
 * Requires `./svm/stand/run-stand.sh --live` validator (or equivalent preload).
 *
 * Records:
 * - Heaviest commerce settle (FixedPrice Buy SPL + absent seller — D-23/D-28)
 * - Bridge foreign mint receive @ URI=160 vs S4b pin 139_638
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SOLANA_DEVNET_ENFORCED_COMPUTE } from "../../lib/web3/bridge/lz-receive-gas.ts";
import { DECLARED_PASSPORT_URI_CEILING_BYTES } from "../../lib/web3/declared-uri-ceiling.ts";
import { runMeasureHeaviestSettle } from "./measure-heaviest-settle.ts";
import { runLiveSvmRoundTrip } from "./live-roundtrip.ts";
import {
  assertStructuredPayloadPresent,
  assertWithinLogLimits,
  measureTxLogBudgetFromMeta,
  SOLANA_LOG_LIMITS,
  type TxLogBudget,
} from "./measure-tx-logs.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, "../lab/package.json"));
const { Connection } = require("@solana/web3.js") as typeof import("@solana/web3.js");

const RPC = process.env.SVM_STAND_RPC ?? "http://127.0.0.1:8899";

export type EventBudgetReport = {
  measuredAt: string;
  validatorRpc: string;
  validatorVersion: string | null;
  heaviestSettle: {
    path: string;
    fixture: string;
    instruction: string;
    signature: string | null;
    budget: TxLogBudget | null;
  };
  bridgeReceiveAtCeiling: {
    uriBytes: number;
    foreignMintCu: number | null;
    pinCu: number;
    deltaToPin: number | null;
    budget: TxLogBudget | null;
  };
};

async function budgetForSignature(
  connection: Connection,
  signature: string | undefined | null,
  label: string,
): Promise<TxLogBudget | null> {
  if (!signature) return null;
  const tx = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  const budget = measureTxLogBudgetFromMeta(tx?.meta);
  if (budget) {
    assertStructuredPayloadPresent(budget, label);
    assertWithinLogLimits(budget, label);
  }
  return budget;
}

export async function measureEventBudgets(): Promise<EventBudgetReport> {
  const connection = new Connection(RPC, "confirmed");
  const versionInfo = await connection.getVersion();
  const validatorVersion =
    typeof versionInfo["solana-core"] === "string" ? versionInfo["solana-core"] : null;

  const heaviest = await runMeasureHeaviestSettle();
  const settleBudget = await budgetForSignature(
    connection,
    heaviest.signature,
    "heaviest-settle",
  );

  const roundTrip = await runLiveSvmRoundTrip();
  assert.equal(roundTrip.liveUriLen, DECLARED_PASSPORT_URI_CEILING_BYTES);
  const bridgeBudget = roundTrip.foreignMintSignature
    ? await budgetForSignature(connection, roundTrip.foreignMintSignature, "bridge-receive")
    : null;

  const foreignCu = roundTrip.foreignMintCu;
  const pin = SOLANA_DEVNET_ENFORCED_COMPUTE;
  if (foreignCu != null && foreignCu >= pin) {
    throw new Error(
      `bridge receive CU ${foreignCu} >= S4b pin ${pin} — stop and re-pin pathway (do not ship)`,
    );
  }

  return {
    measuredAt: new Date().toISOString().slice(0, 10),
    validatorRpc: RPC,
    validatorVersion,
    heaviestSettle: {
      path: heaviest.fixtureDescription,
      fixture: "measure-heaviest-settle",
      instruction: heaviest.ixName,
      signature: heaviest.signature,
      budget: settleBudget,
    },
    bridgeReceiveAtCeiling: {
      uriBytes: roundTrip.liveUriLen,
      foreignMintCu: foreignCu,
      pinCu: pin,
      deltaToPin: foreignCu != null ? pin - foreignCu : null,
      budget: bridgeBudget,
    },
  };
}

function headroom(b: TxLogBudget | null): string {
  if (!b) return "?";
  const bytesLeft = SOLANA_LOG_LIMITS.maxLogDataBytes - b.logMessageBytes;
  const linesLeft = SOLANA_LOG_LIMITS.maxLogLines - b.logLineCount;
  return `${bytesLeft}B / ${linesLeft} lines`;
}

function appendResultsMd(report: EventBudgetReport): void {
  const resultsPath = path.resolve(__dirname, "../lab/RESULTS.md");
  const header = "## S7a structured event budget (";
  let src = fs.readFileSync(resultsPath, "utf8");
  const start = src.indexOf(header);
  if (start >= 0) {
    const end = src.indexOf("\n## ", start + 1);
    src = end >= 0 ? src.slice(0, start) + src.slice(end + 1) : src.slice(0, start);
  }
  const h = report.heaviestSettle.budget;
  const br = report.bridgeReceiveAtCeiling.budget;
  const block = `## S7a structured event budget (${report.measuredAt}) — **MEASURED**

**Host:** local stand \`solana-test-validator\` (\`${report.validatorRpc}\`, ${report.validatorVersion ?? "version unknown"}). **Method:** \`getTransaction\` json \`meta.logMessages\` + \`computeUnitsConsumed\`; structured payload bytes from \`Program data:\` **base64** decode (fail-closed). **Gate:** D-28 log truncation must not be reachable; bridge receive CU must stay below S4b pin.

| Path | Fixture | Instruction | Log bytes | Lines | Program-data bytes | CU | Headroom vs 10KB / 64 lines | vs pin |
|------|---------|-------------|-----------|-------|-------------------|-----|------------------------------|--------|
| Heaviest settle — ${report.heaviestSettle.path} | ${report.heaviestSettle.fixture} | ${report.heaviestSettle.instruction} | ${h?.logMessageBytes ?? "?"} | ${h?.logLineCount ?? "?"} | ${h?.programDataBytes ?? "?"} | ${h?.computeUnits ?? "?"} | ${headroom(h)} | — |
| Bridge foreign mint @ URI=${report.bridgeReceiveAtCeiling.uriBytes} | live-roundtrip | LzReceive | ${br?.logMessageBytes ?? "?"} | ${br?.logLineCount ?? "?"} | ${br?.programDataBytes ?? "?"} | ${report.bridgeReceiveAtCeiling.foreignMintCu ?? "?"} | ${headroom(br)} | pin **${report.bridgeReceiveAtCeiling.pinCu}** (Δ ${report.bridgeReceiveAtCeiling.deltaToPin ?? "?"}) |

**Stop rule:** log msg bytes > **${SOLANA_LOG_LIMITS.maxLogDataBytes}** or log lines > **${SOLANA_LOG_LIMITS.maxLogLines}** → redesign encoding (never split settle). Bridge CU ≥ pin → S4b re-pin (report only).

`;
  fs.writeFileSync(resultsPath, src.trimEnd() + "\n\n" + block, "utf8");
}

function formatBudget(b: TxLogBudget | null): string {
  if (!b) return "n/a";
  return `logMsg=${b.logMessageBytes}B lines=${b.logLineCount} programData=${b.programDataBytes}B (${b.programDataLineCount} lines) cu=${b.computeUnits ?? "?"}`;
}

async function main(): Promise<void> {
  const report = await measureEventBudgets();
  console.log("[S7a measure]", JSON.stringify(report, null, 2));
  console.log("[S7a measure] heaviest settle:", formatBudget(report.heaviestSettle.budget));
  console.log(
    "[S7a measure] bridge @160:",
    formatBudget(report.bridgeReceiveAtCeiling.budget),
    `cu=${report.bridgeReceiveAtCeiling.foreignMintCu} pin=${report.bridgeReceiveAtCeiling.pinCu}`,
  );
  appendResultsMd(report);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
