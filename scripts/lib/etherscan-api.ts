import { SEPOLIA_CHAIN_ID } from "./load-deployment.js";

const ETHERSCAN_V2_API = "https://api.etherscan.io/v2/api";

type SourceCodeResponse = {
  status?: string;
  message?: string;
  result?: Array<{ SourceCode?: string; ContractName?: string }>;
};

export async function isContractVerifiedOnEtherscan(
  address: string,
  apiKey: string,
  chainId = SEPOLIA_CHAIN_ID,
): Promise<boolean | null> {
  const url = new URL(ETHERSCAN_V2_API);
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "getsourcecode");
  url.searchParams.set("address", address);
  url.searchParams.set("apikey", apiKey);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  Etherscan HTTP ${res.status} for ${address} — will try Hardhat verify.`);
      return null;
    }

    const json = (await res.json()) as SourceCodeResponse;
    const source = json.result?.[0]?.SourceCode?.trim() ?? "";
    return source.length > 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  Etherscan status check failed (${message}) — will try Hardhat verify.`);
    return null;
  }
}
