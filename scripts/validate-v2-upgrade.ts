/**
 * Documents MarketplaceEscrow v2 storage layout expectations.
 * v2 deploy uses a fresh proxy — no in-place v1 migration on Base Sepolia.
 *
 * Run after: pnpm hardhat compile
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd());
const v2Artifact = JSON.parse(
  readFileSync(join(root, "artifacts/contracts/MarketplaceEscrow.sol/MarketplaceEscrow.json"), "utf8"),
);

console.log("MarketplaceEscrow v2 storage layout (new proxy — no live migration):");
console.log(JSON.stringify(v2Artifact.storageLayout ?? "no storageLayout in artifact", null, 2));
console.log("");
console.log(
  "Note: v1→v2 in-place upgrade is not used on Base Sepolia. Listing struct removed FiatCurrency enum;",
);
console.log("fresh ERC1967Proxy binds to v2 impl with empty storage.");
