/**
 * CLI: poll reserved GET /ready until answered or timeout.
 * Modes: answered (default, any status) | ready200 (200 only).
 *
 * ready200 timeout (B7):
 *   - at least one non-200 HTTP answer → print pending evidence, exit 0
 *   - never answered → exit 1 with ponder_did_not_become_ready
 *
 * --format json (observation probes): prints ProbeObservation JSON.
 */
import {
  ponderDidNotBecomeReadyMessage,
  ponderSwitchPendingEvidence,
  waitForPonderReady,
  type PonderReadyMode,
} from "./lib/ponder-readiness-probe.js";

function parseArgs(argv: string[]): {
  mode: PonderReadyMode;
  url?: string;
  schema?: string;
  timeoutMs?: number;
  format: "text" | "json";
} {
  let mode: PonderReadyMode = "answered";
  let url: string | undefined;
  let schema: string | undefined;
  let timeoutMs: number | undefined;
  let format: "text" | "json" = "text";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--mode" && argv[i + 1]) {
      const m = argv[++i]!;
      if (m !== "answered" && m !== "ready200") {
        throw new Error(`invalid mode ${m}`);
      }
      mode = m;
    } else if (a === "--url" && argv[i + 1]) {
      url = argv[++i]!;
    } else if (a === "--schema" && argv[i + 1]) {
      schema = argv[++i]!;
    } else if (a === "--timeout-ms" && argv[i + 1]) {
      timeoutMs = Number.parseInt(argv[++i]!, 10);
    } else if (a === "--format" && argv[i + 1]) {
      const f = argv[++i]!;
      if (f !== "text" && f !== "json") {
        throw new Error(`invalid format ${f}`);
      }
      format = f;
    }
  }
  return { mode, url, schema, timeoutMs, format };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await waitForPonderReady({
    mode: args.mode,
    url: args.url,
    timeoutMs: args.timeoutMs,
  });

  if (result.ok) {
    process.stderr.write(
      `ponder ready probe ok mode=${result.mode} status=${result.status} elapsedMs=${result.elapsedMs}\n`,
    );
    if (args.format === "json") {
      process.stdout.write(
        `${JSON.stringify({ kind: "status", code: result.status })}\n`,
      );
    } else {
      process.stdout.write(`${result.status}\n`);
    }
    process.exit(0);
  }

  if (args.format === "json" && args.mode === "answered") {
    process.stdout.write(`${JSON.stringify({ kind: "no_answer" })}\n`);
    process.exit(0);
  }

  // B7: ready200 pending only when the slot answered with a non-200.
  if (args.mode === "ready200" && args.schema && result.hadAnswer) {
    const line = ponderSwitchPendingEvidence(args.schema);
    process.stdout.write(`${line}\n`);
    process.stderr.write(
      `ponder ready200 timeout — pending schema=${args.schema} lastStatus=${result.lastStatus ?? "?"}\n`,
    );
    process.exit(0);
  }

  const msg = ponderDidNotBecomeReadyMessage(result.url, result.timeoutMs);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

main().catch((err) => {
  const detail = err instanceof Error ? err.message : String(err);
  process.stderr.write(`ponder ready probe failed: ${detail}\n`);
  process.stdout.write(
    `${JSON.stringify({ kind: "probe_failed", detail })}\n`,
  );
  process.exit(1);
});
