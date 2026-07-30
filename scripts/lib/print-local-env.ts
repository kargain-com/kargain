import { readFileSync } from "node:fs";

import { DEPLOYMENT_PATH } from "./load-deployment.js";

const deployment = JSON.parse(readFileSync(DEPLOYMENT_PATH, "utf8")) as Record<string, string>;

const exports: string[] = [
  `export NEXT_PUBLIC_ENABLE_LOCAL_CHAIN=1`,
  `export NEXT_PUBLIC_CHAIN_ID=31337`,
  `export NEXT_PUBLIC_RPC_BY_CHAIN='{"31337":"http://127.0.0.1:8545"}'`,
  `export NEXT_PUBLIC_KAR_PASSPORT_ADDRESS='${deployment.karPassport}'`,
  `export NEXT_PUBLIC_KAR_PRO_PASS_ADDRESS='${deployment.karProPass}'`,
  `export NEXT_PUBLIC_KAR_PRO_STAKING_ADDRESS='${deployment.karProStaking}'`,
  `export NEXT_PUBLIC_USDC_ADDRESS='${deployment.usdc}'`,
  `export NEXT_PUBLIC_NATIVE_FEED_ADDRESS='${deployment.nativeFeed}'`,
  `export NEXT_PUBLIC_EUR_FEED_ADDRESS='${deployment.eurFeed ?? "0x0000000000000000000000000000000000000000"}'`,
  `export PONDER_KAR_PASSPORT_ADDRESS='${deployment.karPassport}'`,
  `export PONDER_KAR_PRO_PASS_ADDRESS='${deployment.karProPass}'`,
  `export PONDER_KAR_PRO_STAKING_ADDRESS='${deployment.karProStaking}'`,
  `export PONDER_USDC_ADDRESS='${deployment.usdc}'`,
  `export PONDER_NATIVE_FEED_ADDRESS='${deployment.nativeFeed}'`,
];

console.log(exports.join("\n"));
