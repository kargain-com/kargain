import { execFileSync } from "node:child_process";

export type VerifyRunResult = "verified" | "skipped";

function formatExecError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const withOutput = err as Error & { stdout?: string; stderr?: string };
  return [withOutput.message, withOutput.stdout, withOutput.stderr]
    .filter(Boolean)
    .join("\n");
}

export function runHardhatVerify(params: {
  address: string;
  contract?: string;
  constructorArgs: readonly unknown[];
  network?: string;
}): VerifyRunResult {
  const network = params.network ?? "baseSepolia";
  const args = ["hardhat", "verify", "--network", network];
  if (params.contract) {
    args.push("--contract", params.contract);
  }
  args.push(params.address);
  for (const arg of params.constructorArgs) {
    args.push(String(arg));
  }

  try {
    const stdout = execFileSync("npx", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    if (stdout.trim()) console.log(stdout.trim());
    return "verified";
  } catch (err) {
    const output = formatExecError(err);
    if (/already verified|contract source code already verified/i.test(output)) {
      console.log(`  Already verified on explorer (${params.address}).`);
      return "skipped";
    }
    throw new Error(output);
  }
}
