/**
 * CLI: materialize deployer keypair for Solana CLI.
 * Stdout: pubkey\\tkeypairPath\\tworkDir  (never the secret)
 */
import { createRequire } from "node:module";
import { materializeSolanaDeployer } from "./lib/svm-materialize-deployer.js";

const require = createRequire(import.meta.url);
try {
  require("dotenv").config({ path: ".env.local" });
} catch {
  /* optional — env may already be exported */
}

const m = materializeSolanaDeployer();
process.stdout.write(`${m.pubkey}\t${m.keypairPath}\t${m.workDir}\n`);
