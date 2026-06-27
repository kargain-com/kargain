import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type VerifyRunResult = "verified" | "skipped";

function formatExecError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const withOutput = err as Error & { stdout?: string; stderr?: string };
  return [withOutput.message, withOutput.stdout, withOutput.stderr]
    .filter(Boolean)
    .join("\n");
}

function needsConstructorArgsFile(constructorArgs: readonly unknown[]): boolean {
  return constructorArgs.some(
    (arg) =>
      Array.isArray(arg) ||
      (typeof arg === "object" && arg !== null && !(typeof arg === "bigint")),
  );
}

function serializeArg(arg: unknown): unknown {
  if (typeof arg === "bigint") return arg.toString();
  if (Array.isArray(arg)) return arg.map(serializeArg);
  return arg;
}

export function runHardhatVerify(params: {
  address: string;
  contract?: string;
  constructorArgs: readonly unknown[];
  network?: string;
}): VerifyRunResult {
  const network = params.network ?? "baseSepolia";
  const args = ["hardhat", "verify", "etherscan", "--network", network];
  if (params.contract) {
    args.push("--contract", params.contract);
  }

  if (needsConstructorArgsFile(params.constructorArgs)) {
    const cacheDir = join(process.cwd(), "cache");
    mkdirSync(cacheDir, { recursive: true });
    const argsPath = join(cacheDir, `verify-constructor-args-${Date.now()}.cjs`);
    const serialized = params.constructorArgs.map(serializeArg);
    writeFileSync(
      argsPath,
      `module.exports = ${JSON.stringify(serialized, null, 2)};\n`,
    );
    args.push("--constructor-args-path", argsPath);
  } else {
    for (const arg of params.constructorArgs) {
      args.push(String(arg));
    }
  }

  args.push(params.address);

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
    if (/already being verified/i.test(output)) {
      console.log(`  Verification in progress on explorer (${params.address}) — retry later if needed.`);
      return "skipped";
    }
    throw new Error(output);
  }
}
