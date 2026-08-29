/**
 * Assert every VERIFY_TARGETS builder arity + Solidity types match the compiled
 * artifact ABI `constructor.inputs` (N6-9 V4.1).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  VERIFY_TARGETS,
  type VerifyTargetKey,
} from "../scripts/lib/verify-constructor-args.ts";
import type { DeploymentManifest } from "../scripts/lib/load-deployment.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const fixture: DeploymentManifest = {
  chainId: 84532,
  generation: "v2",
  karPassport: "0x2C46B2310E2cb09b0FEeDd174D9CD3870137F594",
  karProPass: "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1",
  karProStaking: "0xb5d79551BB11F726D2A1A110BAc645C4345dA568",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  timelock: "0x9319e223ff31c954A940b14F04025B56A53ED384",
  commerceGuardian: "0x3333333333333333333333333333333333333333",
  fixedPriceConsignmentImpl: "0x4444444444444444444444444444444444444444",
  ascendingConsignmentImpl: "0x5555555555555555555555555555555555555555",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  forfeitRecipient: "0x4444444444444444444444444444444444444444",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  deployedAt: "2026-06-27T13:35:14.907Z",
  blocks: {},
  indexFromBlock: 43399242,
};

type AbiInput = { type: string; name?: string };
type ArtifactAbi = {
  abi: Array<{ type?: string; inputs?: AbiInput[] }>;
};

function artifactPathFromFqn(fqn: string): string {
  const [source, name] = fqn.split(":");
  if (!source || !name) throw new Error(`Bad FQN ${fqn}`);
  return join(ROOT, "artifacts", source, `${name}.json`);
}

function constructorInputs(fqn: string): AbiInput[] {
  const path = artifactPathFromFqn(fqn);
  assert.ok(existsSync(path), `missing artifact for ${fqn} — compile first`);
  const art = JSON.parse(readFileSync(path, "utf8")) as ArtifactAbi;
  const ctor = art.abi.find((e) => e.type === "constructor");
  return ctor?.inputs ?? [];
}

/** Map a JS constructor-arg value to the Solidity ABI type we expect. */
function expectedSolidityType(value: unknown): string {
  if (typeof value === "bigint") return "uint256";
  if (typeof value === "string" && value.startsWith("0x")) {
    if (value.length === 42) return "address";
    return "bytes"; // initialize calldata etc.
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "address[]";
    if (typeof value[0] === "string" && value[0].startsWith("0x") && value[0].length === 42) {
      return "address[]";
    }
  }
  throw new Error(`Cannot classify constructor arg: ${typeof value}`);
}

describe("verify constructor args vs artifact ABI", () => {
  for (const key of Object.keys(VERIFY_TARGETS) as VerifyTargetKey[]) {
    it(`${key}: builder arity and types match artifact constructor.inputs`, () => {
      const target = VERIFY_TARGETS[key];
      const inputs = constructorInputs(target.contract);
      const args = [...target.buildArgs(fixture)];
      assert.equal(
        args.length,
        inputs.length,
        `${key}: builder length ${args.length} ≠ ABI ${inputs.length}`,
      );
      for (let i = 0; i < inputs.length; i++) {
        const got = expectedSolidityType(args[i]);
        const want = inputs[i]!.type;
        assert.equal(
          got,
          want,
          `${key} arg[${i}] type ${got} ≠ ABI ${want} (${inputs[i]!.name ?? ""})`,
        );
      }
    });
  }
});
