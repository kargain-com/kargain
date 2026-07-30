import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  hardhatErrorCode,
  isBytecodeMismatchVerifyError,
  summarizeVerifyError,
} from "./verify-failure-class.js";

export type VerifyRunResult = "verified" | "skipped" | "bytecode_mismatch";

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
  /** Mapping of library names → addresses for linked contracts (`--libraries-path`). */
  libraries?: Record<string, string>;
}): VerifyRunResult {
  const network = params.network ?? "baseSepolia";
  const args = ["hardhat", "verify", "etherscan", "--network", network];
  if (params.contract) {
    args.push("--contract", params.contract);
  }

  if (params.libraries && Object.keys(params.libraries).length > 0) {
    const cacheDir = join(process.cwd(), "cache");
    mkdirSync(cacheDir, { recursive: true });
    const libsPath = join(cacheDir, `verify-libraries-${Date.now()}.cjs`);
    writeFileSync(
      libsPath,
      `module.exports = ${JSON.stringify(params.libraries, null, 2)};\n`,
    );
    args.push("--libraries-path", libsPath);
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
    if (isBytecodeMismatchVerifyError(output)) {
      const code = hardhatErrorCode(output);
      console.log(
        `  Bytecode mismatch${code ? ` (${code})` : ""} — local compile differs from on-chain.`,
      );
      return "bytecode_mismatch";
    }
    throw new Error(summarizeVerifyError(output));
  }
}
