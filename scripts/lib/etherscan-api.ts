/**
 * Sole Etherscan API v2 HTTP owner (getsourcecode + verifysourcecode + poll).
 * Never logs the API key.
 */
import { SEPOLIA_CHAIN_ID } from "./load-deployment.js";

const ETHERSCAN_V2_API = "https://api.etherscan.io/v2/api";

type SourceCodeResponse = {
  status?: string;
  message?: string;
  result?: Array<{ SourceCode?: string; ContractName?: string }>;
};

type ApiEnvelope = {
  status?: string;
  message?: string;
  result?: string;
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
      console.warn(
        `  Etherscan HTTP ${res.status} for ${address} — will try submit.`,
      );
      return null;
    }

    const json = (await res.json()) as SourceCodeResponse;
    const source = json.result?.[0]?.SourceCode?.trim() ?? "";
    return source.length > 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  Etherscan status check failed (${message}) — will try submit.`);
    return null;
  }
}

export type StandardJsonSubmitParams = {
  chainId: number;
  apiKey: string;
  address: string;
  /** e.g. contracts/KarPassport.sol:KarPassport */
  contractName: string;
  /** e.g. v0.8.28+commit.7893614a */
  compilerVersion: string;
  /** Hardhat build-info `input` object (language/settings/sources). */
  standardJsonInput: unknown;
  /** ABI-encoded constructor args hex without 0x; empty string if none. */
  constructorArgumentsHex: string;
  /** Optional linked libraries (Ascending impl). */
  libraries?: Record<string, string>;
};

/**
 * POST verifysourcecode with solidity-standard-json-input.
 * Returns the receipt GUID.
 */
export async function submitStandardJsonVerification(
  params: StandardJsonSubmitParams,
): Promise<string> {
  const url = new URL(ETHERSCAN_V2_API);
  url.searchParams.set("chainid", String(params.chainId));

  const body = new URLSearchParams();
  body.set("module", "contract");
  body.set("action", "verifysourcecode");
  body.set("apikey", params.apiKey);
  body.set("contractaddress", params.address);
  body.set("sourceCode", JSON.stringify(params.standardJsonInput));
  body.set("codeformat", "solidity-standard-json-input");
  body.set("contractname", params.contractName);
  body.set("compilerversion", params.compilerVersion);
  if (params.constructorArgumentsHex) {
    body.set(
      "constructorArguments",
      params.constructorArgumentsHex.replace(/^0x/i, ""),
    );
  }
  if (params.libraries) {
    let i = 1;
    for (const [name, address] of Object.entries(params.libraries)) {
      body.set(`libraryname${i}`, name);
      body.set(`libraryaddress${i}`, address);
      i += 1;
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Etherscan verifysourcecode HTTP ${res.status}`);
  }
  const json = (await res.json()) as ApiEnvelope;
  if (json.status !== "1" || !json.result) {
    throw new Error(
      `Etherscan verifysourcecode refused: ${json.message ?? "?"} — ${json.result ?? "(no result)"}`,
    );
  }
  return json.result;
}

export type VerificationPollResult = {
  /** Explorer `result` string (verbatim). */
  result: string;
  passed: boolean;
};

/**
 * Poll checkverifystatus until Pass/Fail or timeout.
 */
export async function pollVerificationStatus(params: {
  chainId: number;
  apiKey: string;
  guid: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<VerificationPollResult> {
  const timeoutMs = params.timeoutMs ?? 180_000;
  const intervalMs = params.intervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const url = new URL(ETHERSCAN_V2_API);
    url.searchParams.set("chainid", String(params.chainId));
    url.searchParams.set("module", "contract");
    url.searchParams.set("action", "checkverifystatus");
    url.searchParams.set("guid", params.guid);
    url.searchParams.set("apikey", params.apiKey);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Etherscan checkverifystatus HTTP ${res.status}`);
    }
    const json = (await res.json()) as ApiEnvelope;
    const result = String(json.result ?? "");
    const lower = result.toLowerCase();
    if (lower.includes("pass") && !lower.includes("pending")) {
      return { result, passed: true };
    }
    if (
      lower.includes("fail") ||
      lower.includes("unable") ||
      lower.includes("error") ||
      (json.status === "0" && !lower.includes("pending"))
    ) {
      return { result, passed: false };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return {
    result: `Timed out after ${timeoutMs}ms waiting for guid ${params.guid}`,
    passed: false,
  };
}
