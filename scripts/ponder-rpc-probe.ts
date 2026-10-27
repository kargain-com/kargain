/**
 * CLI: probe every commercial Ponder RPC provider at the configured getLogs window.
 * Exit 0 only when every provider returns verdict `ok`.
 * Human diagnostics on stderr; one JSON summary line on stdout.
 */
import {
  commercialPonderProbeChainIds,
  probePonderRpcCapability,
  type PonderRpcProbeResult,
} from "./lib/ponder-rpc-probe.js";

async function main(): Promise<void> {
  const results: PonderRpcProbeResult[] = [];
  let allOk = true;
  for (const chainId of commercialPonderProbeChainIds()) {
    const result = await probePonderRpcCapability(chainId);
    results.push(result);
    for (const p of result.providers) {
      process.stderr.write(
        `ponder-rpc-probe chain=${chainId} url=${p.url} verdict=${p.verdict}${
          p.detail ? ` detail=${p.detail}` : ""
        }\n`,
      );
    }
    if (!result.ok) allOk = false;
  }
  process.stdout.write(`${JSON.stringify({ ok: allOk, results })}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(
    `ponder-rpc-probe failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
