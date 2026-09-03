/**
 * Sole owner: verify nuclear contracts on Etherscan/Basescan from retained
 * deploy-time build-info + manifest constructor args — without Hardhat verify.
 *
 * Fail-closed via {@link assertDeployEvidence} before any submit.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  encodeAbiParameters,
  type Abi,
  type AbiParameter,
} from "viem";

type AbiConstructorFragment = Extract<Abi[number], { type: "constructor" }>;

import { assertDeployEvidence } from "./assert-deploy-evidence.js";
import {
  deploymentArtifactsDirForChain,
  deploymentBuildInfoPathForChain,
} from "./deployment-build-info.js";
import {
  isContractVerifiedOnEtherscan,
  pollVerificationStatus,
  submitStandardJsonVerification,
} from "./etherscan-api.js";
import type { DeploymentManifest } from "./load-deployment.js";
import {
  VERIFY_TARGETS,
  type HubVerifyTargetKey,
} from "./verify-constructor-args.js";

export type VerifyFromEvidenceStatus =
  | "verified"
  | "skipped"
  | "failed";

export type VerifyFromEvidenceResult = {
  key: HubVerifyTargetKey;
  label: string;
  address: `0x${string}`;
  status: VerifyFromEvidenceStatus;
  /** Explorer poll / refuse text when applicable. */
  detail?: string;
};

type StoredBuildInfo = {
  solcLongVersion?: string;
  solcVersion?: string;
  input: unknown;
};

type ArtifactJson = {
  abi: Abi;
};

function compilerVersionFromBuildInfo(bi: StoredBuildInfo): string {
  const raw = (bi.solcLongVersion ?? bi.solcVersion ?? "").trim();
  if (!raw) throw new Error("Stored build-info missing solcLongVersion");
  return raw.startsWith("v") ? raw : `v${raw}`;
}

function loadStoredBuildInfo(chainId: number): StoredBuildInfo {
  const path = deploymentBuildInfoPathForChain(chainId);
  return JSON.parse(readFileSync(path, "utf8")) as StoredBuildInfo;
}

function artifactRelPathForContract(contract: string): string {
  // contracts/Foo.sol:Bar → contracts/Foo.sol/Bar.json
  // @openzeppelin/.../ERC1967Proxy.sol:ERC1967Proxy → same
  const [file, name] = contract.split(":");
  if (!file || !name) {
    throw new Error(`Bad contract id ${contract}`);
  }
  return `${file}/${name}.json`;
}

function readConstructorInputs(
  chainId: number,
  contract: string,
): readonly AbiParameter[] {
  const rel = artifactRelPathForContract(contract);
  const stored = join(deploymentArtifactsDirForChain(chainId), rel);
  const cwd = join(process.cwd(), "artifacts", rel);
  let raw: string;
  try {
    raw = readFileSync(stored, "utf8");
  } catch {
    raw = readFileSync(cwd, "utf8");
  }
  const artifact = JSON.parse(raw) as ArtifactJson;
  const ctor = artifact.abi.find(
    (x): x is AbiConstructorFragment => x.type === "constructor",
  );
  return ctor?.inputs ?? [];
}

/** ABI-encode VERIFY_TARGETS constructor args; empty string when no args. */
export function encodeConstructorArgumentsHex(
  chainId: number,
  contract: string,
  args: readonly unknown[],
): string {
  const inputs = readConstructorInputs(chainId, contract);
  if (inputs.length === 0) {
    if (args.length !== 0) {
      throw new Error(
        `Contract ${contract} has no constructor inputs but got ${args.length} args`,
      );
    }
    return "";
  }
  if (inputs.length !== args.length) {
    throw new Error(
      `Constructor arity mismatch for ${contract}: ABI ${inputs.length} ≠ args ${args.length}`,
    );
  }
  const encoded = encodeAbiParameters(inputs, args as never[]);
  return encoded.replace(/^0x/i, "");
}

const DEFAULT_ORDER: HubVerifyTargetKey[] = [
  "timelock",
  "karProStaking",
  "karPassport",
  "bridgeGateway",
  "fixedPriceConsignmentImpl",
  "fixedPriceConsignmentProxy",
  "ascendingHoldLib",
  "ascendingOpenLib",
  "ascendingConsignmentImpl",
  "ascendingConsignmentProxy",
];

export async function verifyManifestFromDeployEvidence(params: {
  manifest: DeploymentManifest;
  apiKey: string;
  force?: boolean;
  order?: readonly HubVerifyTargetKey[];
}): Promise<VerifyFromEvidenceResult[]> {
  const evidence = assertDeployEvidence(params.manifest);
  if (!evidence.ok) {
    throw new Error(
      [
        "Deploy evidence check failed — refuse explorer verify:",
        ...evidence.reasons.map((r) => `  - ${r}`),
      ].join("\n"),
    );
  }

  const buildInfo = loadStoredBuildInfo(params.manifest.chainId);
  const compilerVersion = compilerVersionFromBuildInfo(buildInfo);
  const order = params.order ?? DEFAULT_ORDER;
  const out: VerifyFromEvidenceResult[] = [];

  for (const key of order) {
    const target = VERIFY_TARGETS[key];
    const rawAddress = params.manifest[
      target.addressKey as keyof DeploymentManifest
    ] as `0x${string}` | undefined;
    if (!rawAddress) {
      out.push({
        key,
        label: target.label,
        address: "0x0000000000000000000000000000000000000000",
        status: "skipped",
        detail: "address not in manifest",
      });
      continue;
    }

    if (!params.force) {
      const already = await isContractVerifiedOnEtherscan(
        rawAddress,
        params.apiKey,
        params.manifest.chainId,
      );
      if (already === true) {
        out.push({
          key,
          label: target.label,
          address: rawAddress,
          status: "skipped",
          detail: "source already verified on explorer",
        });
        continue;
      }
    }

    const args = target.buildArgs(params.manifest);
    let ctorHex: string;
    try {
      ctorHex = encodeConstructorArgumentsHex(
        params.manifest.chainId,
        target.contract,
        args,
      );
    } catch (err) {
      out.push({
        key,
        label: target.label,
        address: rawAddress,
        status: "failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const libraries =
      key === "ascendingConsignmentImpl" &&
      params.manifest.ascendingHoldLib &&
      params.manifest.ascendingOpenLib
        ? {
            AscendingHoldLib: params.manifest.ascendingHoldLib,
            AscendingOpenLib: params.manifest.ascendingOpenLib,
          }
        : undefined;

    try {
      const guid = await submitStandardJsonVerification({
        chainId: params.manifest.chainId,
        apiKey: params.apiKey,
        address: rawAddress,
        contractName: target.contract,
        compilerVersion,
        standardJsonInput: buildInfo.input,
        constructorArgumentsHex: ctorHex,
        libraries,
      });
      const poll = await pollVerificationStatus({
        chainId: params.manifest.chainId,
        apiKey: params.apiKey,
        guid,
      });
      out.push({
        key,
        label: target.label,
        address: rawAddress,
        status: poll.passed ? "verified" : "failed",
        detail: poll.result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Already verified is success-class for our purposes.
      if (/already verified/i.test(message)) {
        out.push({
          key,
          label: target.label,
          address: rawAddress,
          status: "skipped",
          detail: message,
        });
      } else {
        out.push({
          key,
          label: target.label,
          address: rawAddress,
          status: "failed",
          detail: message,
        });
      }
    }
  }

  return out;
}
