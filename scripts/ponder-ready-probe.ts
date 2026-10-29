/**
 * CLI: poll reserved GET /ready until answered or timeout.
 * Modes: answered (default, any status) | ready200 (200 only).
 * On ready200 timeout with --schema: print ADR 0014 pending evidence and exit 0.
 * On success stdout is only the decimal HTTP status.
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
} {
  let mode: PonderReadyMode = "answered";
  let url: string | undefined;
  let schema: string | undefined;
  let timeoutMs: number | undefined;
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
    }
  }
  return { mode, url, schema, timeoutMs };
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
    process.stdout.write(`${result.status}\n`);
    process.exit(0);
  }
  if (args.mode === "ready200" && args.schema) {
    const line = ponderSwitchPendingEvidence(args.schema);
    process.stdout.write(`${line}\n`);
    process.stderr.write(
      `ponder ready200 timeout — pending schema=${args.schema}\n`,
    );
    process.exit(0);
  }
  const msg = ponderDidNotBecomeReadyMessage(result.url, result.timeoutMs);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(
    `ponder ready probe failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
