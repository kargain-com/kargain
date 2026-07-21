/**
 * EIP-170 deploy-size gate for production contracts.
 *
 * hardhat.config keeps allowUnlimitedContractSize for EndpointV2Mock;
 * this suite restores the 24,576-byte mainnet limit for protocol contracts.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const EIP170_MAX = 24_576;

const PRODUCTION_CONTRACTS = [
  { name: "KarPassport", artifactPath: "artifacts/contracts/KarPassport.sol/KarPassport.json" },
  {
    name: "MarketplaceEscrow",
    artifactPath: "artifacts/contracts/MarketplaceEscrow.sol/MarketplaceEscrow.json",
  },
  {
    name: "AuctionEscrow",
    artifactPath: "artifacts/contracts/AuctionEscrow.sol/AuctionEscrow.json",
  },
  {
    name: "KarProStaking",
    artifactPath: "artifacts/contracts/KarProStaking.sol/KarProStaking.json",
  },
  { name: "Timelock48h", artifactPath: "artifacts/contracts/Timelock48h.sol/Timelock48h.json" },
  {
    name: "KarPassportBridgeGateway",
    artifactPath:
      "artifacts/contracts/KarPassportBridgeGateway.sol/KarPassportBridgeGateway.json",
  },
] as const;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function deployedBytecodeBytes(artifactPath: string, name: string): number {
  const abs = path.join(repoRoot, artifactPath);
  if (!existsSync(abs)) {
    assert.fail(
      `Missing artifact for ${name} at ${artifactPath}. Run "pnpm hardhat compile" first.`,
    );
  }
  const artifact = JSON.parse(readFileSync(abs, "utf8")) as { deployedBytecode?: string };
  const hex = artifact.deployedBytecode;
  if (typeof hex !== "string" || !hex.startsWith("0x")) {
    assert.fail(`${name}: artifact missing deployedBytecode hex string`);
  }
  return (hex.length - 2) / 2;
}

describe("EIP-170 production contract size", () => {
  for (const { name, artifactPath } of PRODUCTION_CONTRACTS) {
    it(`${name} deployed bytecode ≤ ${EIP170_MAX} bytes`, () => {
      const bytes = deployedBytecodeBytes(artifactPath, name);
      assert.ok(
        bytes <= EIP170_MAX,
        `${name} deployed bytecode ${bytes} bytes exceeds EIP-170 limit ${EIP170_MAX}`,
      );
    });
  }

  it("reports size table for all production contracts", () => {
    const rows = PRODUCTION_CONTRACTS.map(({ name, artifactPath }) => ({
      name,
      bytes: deployedBytecodeBytes(artifactPath, name),
    }));
    process.stdout.write("\n--- EIP-170 deployed bytecode sizes ---\n");
    process.stdout.write("| Contract | bytes |\n| --- | --- |\n");
    for (const row of rows) {
      process.stdout.write(`| ${row.name} | ${row.bytes} |\n`);
      assert.ok(
        row.bytes <= EIP170_MAX,
        `${row.name} deployed bytecode ${row.bytes} bytes exceeds EIP-170 limit ${EIP170_MAX}`,
      );
    }
    process.stdout.write(`Limit: ${EIP170_MAX} (EIP-170)\n\n`);
  });
});
