/**
 * CLI: poll svm-ingest GET /ready until HTTP 200 or timeout; exit 1 by name.
 * On success stdout is only the decimal HTTP status (deploy evidence capture).
 * On timeout stderr carries classifySvmIngestReadySurface + payload status.
 */
import {
  svmIngestDidNotBecomeReadyMessage,
  waitForSvmIngestReady,
} from "./lib/svm-ingest-readiness-probe.js";

async function main(): Promise<void> {
  const result = await waitForSvmIngestReady();
  if (result.ok) {
    process.stderr.write(
      `svm-ingest ready probe ok status=${result.status} elapsedMs=${result.elapsedMs}\n`,
    );
    process.stdout.write(`${result.status}\n`);
    process.exit(0);
  }
  const msg = svmIngestDidNotBecomeReadyMessage(result);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(
    `svm-ingest ready probe failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
