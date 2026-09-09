/**
 * CLI: poll reserved GET /ready until answered or timeout; exit 1 by name.
 */
import {
  ponderDidNotBecomeReadyMessage,
  waitForPonderReady,
} from "./lib/ponder-readiness-probe.js";

async function main(): Promise<void> {
  const result = await waitForPonderReady();
  if (result.ok) {
    process.stderr.write(
      `ponder ready probe ok status=${result.status} elapsedMs=${result.elapsedMs}\n`,
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
