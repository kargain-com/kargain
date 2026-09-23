/**
 * CLI: isolation preflight + wait until stand RPC and websocket are ready.
 *
 * Usage (from repo root, after starting the validator):
 *   pnpm exec tsx svm/stand/wait-stand-ready.ts [--skip-isolation]
 *
 * `--skip-isolation` is for the wait-after-start phase only (ports will be in use
 * by our own validator). Isolation runs before start in run-stand.sh.
 */
import {
  assertStandIsolation,
  isLocalPortAccepting,
  standReadyPortsForLocalValidator,
  waitStandValidatorReady,
} from "./stand-validator-ready.ts";

async function main(): Promise<void> {
  const skipIsolation = process.argv.includes("--skip-isolation");
  const allowHardhat = process.env.KARGAIN_SVM_STAND_EVM === "1";

  if (!skipIsolation) {
    await assertStandIsolation({
      isPortAccepting: isLocalPortAccepting,
      allowHardhat,
    });
    console.log("    stand isolation ok (8899/8900 free; hardhat gate checked)");
    return;
  }

  const ready = await waitStandValidatorReady(standReadyPortsForLocalValidator());
  console.log(
    `    validator ready (rpc+websocket) elapsedMs=${ready.elapsedMs}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
