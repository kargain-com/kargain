import {
  ETHEREUM_SEPOLIA_PUBLIC_RPC,
  SEPOLIA_PUBLIC_RPC,
} from "../lib/web3/sepolia-addresses.js";
import { SEPOLIA_CHAIN_ID, SPOKE_CHAIN_ID } from "./lib/load-deployment.js";
import {
  resolveCommercialStack,
  type ResolvedCommercialStack,
} from "./lib/resolve-sepolia-stack.js";

function stackLines(label: string, stack: ResolvedCommercialStack): string[] {
  return [
    `${label} (${stack.chainId})`,
    `  indexFromBlock: ${stack.indexFromBlock}`,
    `  karPassport:    ${stack.karPassport}`,
    `  fixedPrice:     ${stack.fixedPriceConsignment ?? "(none — Nuclear #2)"}`,
    `  ascending:      ${stack.ascendingConsignment ?? "(none — Nuclear #2)"}`,
    `  gateway:        ${stack.bridgeGateway}`,
    "",
  ];
}

function main() {
  const hub = resolveCommercialStack(SEPOLIA_CHAIN_ID);
  const eth = resolveCommercialStack(SPOKE_CHAIN_ID);
  const lines = [
    "Kargain commercial stacks (COMMERCIAL_ACTIVE in lib/web3/commercial-active.ts)",
    "===============================================================================",
    "",
    ...stackLines("Base Sepolia", hub),
    ...stackLines("Ethereum Sepolia", eth),
    "Network (VPS — see .env.example):",
    `  PONDER_RPC_URL_84532=${process.env.PONDER_RPC_URL_84532 ?? SEPOLIA_PUBLIC_RPC}`,
    `  PONDER_RPC_URL_11155111=${process.env.PONDER_RPC_URL_11155111 ?? ETHEREUM_SEPOLIA_PUBLIC_RPC}`,
    `  NEXT_PUBLIC_RPC_BY_CHAIN={"84532":"${SEPOLIA_PUBLIC_RPC}","11155111":"${ETHEREUM_SEPOLIA_PUBLIC_RPC}"}`,
    "",
    "Start blocks and addresses come from the registry only (ADR 0016 §a).",
    "A change ships as a reviewed registry change; the deploy switches schemas.",
  ];
  console.log(lines.join("\n"));
}

main();
