/**
 * Read-only: immutable-filled local runtime ≡ eth_getCode for every nuclear
 * address in the manifest. Safe any time (not only post-deploy).
 *
 *   pnpm verify:bytecode-identity
 *   pnpm verify:bytecode-identity -- --eth
 */
import { config as loadEnv } from "dotenv";

import {
  assertManifestBytecodeIdentity,
  publicClientForManifestChain,
} from "./lib/on-chain-bytecode-identity.js";
import {
  commercialDeploymentPath,
  requireCommercialDeployment,
  requireSepoliaDeployment,
  SEPOLIA_DEPLOYMENT_PATH,
} from "./lib/load-deployment.js";

loadEnv({ path: ".env.local" });
loadEnv();

async function main() {
  const eth =
    process.argv.includes("--eth") || process.argv.includes("--chain=11155111");
  let manifest;
  try {
    manifest = eth
      ? requireCommercialDeployment(11155111)
      : requireSepoliaDeployment();
  } catch {
    const path = eth ? commercialDeploymentPath(11155111) : SEPOLIA_DEPLOYMENT_PATH();
    console.error(`Missing ${path} — run nuclear deploy first`);
    process.exit(1);
  }

  const rpcHint =
    manifest.chainId === 11155111
      ? process.env.ETH_SEPOLIA_RPC_URL ??
        "https://ethereum-sepolia-rpc.publicnode.com"
      : process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
  console.log(
    `On-chain bytecode identity — chain ${manifest.chainId} via ${new URL(rpcHint).host}`,
  );

  const client = publicClientForManifestChain(manifest.chainId);
  const results = await assertManifestBytecodeIdentity(manifest, client);
  for (const r of results) {
    console.log(
      `  OK ${r.label} ${r.address} body=${r.localBodyLen}B (CBOR stripped)`,
    );
  }
  console.log(`\n${results.length} contract(s) — executable body matches repository.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
