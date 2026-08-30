/**
 * Solana LayerZero OApp identity = gateway_config PDA (`["config"]`), not the
 * program id. Hub `setPeer(40168, …)` must target this PDA.
 */
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function loadWeb3(): typeof import("@solana/web3.js") {
  const require = createRequire(import.meta.url);
  try {
    return require("@solana/web3.js");
  } catch {
    const root = join(process.cwd(), "node_modules/.pnpm");
    const hit = readdirSync(root).find((d) => d.startsWith("@solana+web3.js@"));
    if (!hit) throw new Error("@solana/web3.js not found");
    return require(join(root, hit, "node_modules/@solana/web3.js"));
  }
}

/** Gateway config PDA for a deployed `kar_gateway` program id (base58). */
export function svmGatewayOAppPeer(gatewayProgramId: string): string {
  const { PublicKey } = loadWeb3();
  const programId = new PublicKey(gatewayProgramId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  )[0].toBase58();
}
