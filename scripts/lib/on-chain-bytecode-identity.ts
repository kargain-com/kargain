/**
 * Sole owner: compare immutable-filled local `deployedBytecode` to `eth_getCode`
 * (CBOR metadata stripped). Proves deployed ≡ repository without an explorer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  getAddress,
  http,
  padHex,
  toHex,
  type Hex,
  type PublicClient,
} from "viem";

import type { DeploymentManifest } from "./load-deployment.js";

export type ImmRef = { length: number; start: number };

export type ArtifactRuntime = {
  deployedBytecode: Hex;
  immutableReferences?: Record<string, ImmRef[]>;
  deployedLinkReferences?: Record<
    string,
    Record<string, { start: number; length: number }[]>
  >;
};

export function stripCborMetadata(code: Hex): { body: Hex; metaLen: number } {
  const buf = Buffer.from(code.slice(2), "hex");
  if (buf.length < 2) return { body: code, metaLen: 0 };
  const metaLen = (buf[buf.length - 2]! << 8) | buf[buf.length - 1]!;
  if (metaLen === 0 || metaLen + 2 > buf.length) return { body: code, metaLen: 0 };
  const start = buf.length - metaLen - 2;
  return {
    body: (`0x${buf.subarray(0, start).toString("hex")}`) as Hex,
    metaLen,
  };
}

export function firstDiffOffset(a: Hex, b: Hex): number | null {
  const A = Buffer.from(a.slice(2), "hex");
  const B = Buffer.from(b.slice(2), "hex");
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    if (A[i] !== B[i]) return i;
  }
  return A.length === B.length ? null : n;
}

function addrWord(a: string): Hex {
  return padHex(getAddress(a) as Hex, { size: 32 });
}

function uintWord(n: bigint): Hex {
  return padHex(toHex(n), { size: 32 });
}

export function fillImmutableSlots(
  deployed: Hex,
  refs: Record<string, ImmRef[]> | undefined,
  valuesByAstId: Record<string, Hex>,
): Hex {
  if (!refs || Object.keys(refs).length === 0) return deployed;
  const buf = Buffer.from(deployed.slice(2), "hex");
  for (const [id, slots] of Object.entries(refs)) {
    const word = valuesByAstId[id];
    if (!word) {
      throw new Error(`Missing immutable value for AST id ${id}`);
    }
    const bytes = Buffer.from(word.slice(2), "hex");
    if (bytes.length !== 32) throw new Error(`Expected 32-byte word for ${id}`);
    for (const { start, length } of slots) {
      if (length !== 32) {
        throw new Error(`Unexpected immutable length ${length} at ${start}`);
      }
      bytes.copy(buf, start, 0, 32);
    }
  }
  return (`0x${buf.toString("hex")}`) as Hex;
}

export function linkLibraries(
  deployed: Hex,
  linkRefs:
    | Record<string, Record<string, { start: number; length: number }[]>>
    | undefined,
  libraries: Record<string, `0x${string}`>,
): Hex {
  if (!linkRefs || Object.keys(linkRefs).length === 0) return deployed;
  // Placeholders are `__$…$__` (non-hex) — mutate the hex string, not Buffer.from.
  let hex = deployed.slice(2);
  for (const fileLinks of Object.values(linkRefs)) {
    for (const [libName, slots] of Object.entries(fileLinks)) {
      const addr = libraries[libName];
      if (!addr) throw new Error(`Missing library address for ${libName}`);
      const addrHex = getAddress(addr).slice(2).toLowerCase();
      if (addrHex.length !== 40) throw new Error(`Bad library address ${libName}`);
      for (const { start, length } of slots) {
        if (length !== 20) {
          throw new Error(`Unexpected link length ${length} for ${libName}`);
        }
        const from = start * 2;
        hex = hex.slice(0, from) + addrHex + hex.slice(from + 40);
      }
    }
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("Bytecode still contains library placeholders after linking");
  }
  return (`0x${hex}`) as Hex;
}

export function loadArtifactRuntime(relPath: string): ArtifactRuntime {
  const p = join(process.cwd(), "artifacts", relPath);
  return JSON.parse(readFileSync(p, "utf8")) as ArtifactRuntime;
}

/** UUPS `__self` immutable (OZ) — AST id is stable in current OZ 5.6.1 compile unit. */
const UUPS_SELF_AST_ID = "6254";

export type IdentityTarget = {
  label: string;
  addressKey: keyof DeploymentManifest;
  artifactRelPath: string;
  /** Build AST-id → 32-byte word map for this address + manifest. */
  immutableValues: (
    manifest: DeploymentManifest,
    self: `0x${string}`,
  ) => Record<string, Hex>;
  libraries?: (
    manifest: DeploymentManifest,
  ) => Record<string, `0x${string}`> | undefined;
};

export const BYTECODE_IDENTITY_TARGETS: IdentityTarget[] = [
  {
    label: "Timelock48h",
    addressKey: "timelock",
    artifactRelPath: "contracts/Timelock48h.sol/Timelock48h.json",
    immutableValues: () => ({}),
  },
  {
    label: "KarProPass",
    addressKey: "karProPass",
    artifactRelPath: "contracts/KarProPass.sol/KarProPass.json",
    immutableValues: () => ({}),
  },
  {
    label: "KarProStaking",
    addressKey: "karProStaking",
    artifactRelPath: "contracts/KarProStaking.sol/KarProStaking.json",
    immutableValues: (m) => ({
      "22555": addrWord(m.karProPass),
    }),
  },
  {
    label: "KarPassport",
    addressKey: "karPassport",
    artifactRelPath: "contracts/KarPassport.sol/KarPassport.json",
    immutableValues: (m) => {
      if (!m.forfeitRecipient) throw new Error("Manifest missing forfeitRecipient");
      if (!m.tokenIdOffset) throw new Error("Manifest missing tokenIdOffset");
      return {
        "19530": addrWord(m.karProStaking),
        "19532": addrWord(m.forfeitRecipient),
        "19534": uintWord(BigInt(m.tokenIdOffset)),
      };
    },
  },
  {
    label: "FixedPriceConsignmentImpl",
    addressKey: "fixedPriceConsignmentImpl",
    artifactRelPath: "contracts/FixedPriceConsignment.sol/FixedPriceConsignment.json",
    immutableValues: (_m, self) => ({
      [UUPS_SELF_AST_ID]: addrWord(self),
    }),
  },
  {
    label: "AscendingHoldLib",
    addressKey: "ascendingHoldLib",
    artifactRelPath: "contracts/lib/AscendingHoldLib.sol/AscendingHoldLib.json",
    immutableValues: (_m, self) => ({
      library_deploy_address: addrWord(self),
    }),
  },
  {
    label: "AscendingOpenLib",
    addressKey: "ascendingOpenLib",
    artifactRelPath: "contracts/lib/AscendingOpenLib.sol/AscendingOpenLib.json",
    immutableValues: (_m, self) => ({
      library_deploy_address: addrWord(self),
    }),
  },
  {
    label: "AscendingConsignmentImpl",
    addressKey: "ascendingConsignmentImpl",
    artifactRelPath: "contracts/AscendingConsignment.sol/AscendingConsignment.json",
    immutableValues: (_m, self) => ({
      [UUPS_SELF_AST_ID]: addrWord(self),
    }),
    libraries: (m) => {
      if (!m.ascendingHoldLib || !m.ascendingOpenLib) {
        throw new Error("Manifest missing Ascending libraries");
      }
      return {
        AscendingHoldLib: m.ascendingHoldLib,
        AscendingOpenLib: m.ascendingOpenLib,
      };
    },
  },
  {
    label: "KarPassportBridgeGateway",
    addressKey: "bridgeGateway",
    artifactRelPath:
      "contracts/KarPassportBridgeGateway.sol/KarPassportBridgeGateway.json",
    immutableValues: (m) => {
      if (!m.layerZeroEndpoint) throw new Error("Manifest missing layerZeroEndpoint");
      return {
        "1386": addrWord(m.layerZeroEndpoint),
        "2765": addrWord(m.karPassport),
      };
    },
  },
  {
    label: "FixedPriceConsignmentProxy",
    addressKey: "fixedPriceConsignment",
    artifactRelPath:
      "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json",
    immutableValues: () => ({}),
  },
  {
    label: "AscendingConsignmentProxy",
    addressKey: "ascendingConsignment",
    artifactRelPath:
      "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json",
    immutableValues: () => ({}),
  },
];

export type IdentityResult = {
  label: string;
  address: `0x${string}`;
  equal: boolean;
  localBodyLen: number;
  chainBodyLen: number;
  firstDiff: number | null;
};

export function prepareExpectedRuntime(
  target: IdentityTarget,
  manifest: DeploymentManifest,
  self: `0x${string}`,
): Hex {
  const art = loadArtifactRuntime(target.artifactRelPath);
  let code = art.deployedBytecode;
  const libs = target.libraries?.(manifest);
  if (libs) {
    code = linkLibraries(code, art.deployedLinkReferences, libs);
  }
  code = fillImmutableSlots(
    code,
    art.immutableReferences,
    target.immutableValues(manifest, self),
  );
  return stripCborMetadata(code).body;
}

export async function assertManifestBytecodeIdentity(
  manifest: DeploymentManifest,
  client: PublicClient,
): Promise<IdentityResult[]> {
  const results: IdentityResult[] = [];
  for (const target of BYTECODE_IDENTITY_TARGETS) {
    const raw = manifest[target.addressKey] as `0x${string}` | undefined;
    if (!raw) continue;
    const address = getAddress(raw);
    const chainCode = (await client.getBytecode({ address })) as Hex | undefined;
    if (!chainCode || chainCode === "0x") {
      throw new Error(`No code at ${target.label} ${address}`);
    }
    const expectedBody = prepareExpectedRuntime(target, manifest, address);
    const chainBody = stripCborMetadata(chainCode).body;
    const firstDiff = firstDiffOffset(expectedBody, chainBody);
    const equal = firstDiff === null && expectedBody.length === chainBody.length;
    results.push({
      label: target.label,
      address,
      equal,
      localBodyLen: (expectedBody.length - 2) / 2,
      chainBodyLen: (chainBody.length - 2) / 2,
      firstDiff,
    });
    if (!equal) {
      throw new Error(
        `${target.label} @ ${address}: executable body ≠ local artifact ` +
          `(firstDiff=${firstDiff}, localLen=${(expectedBody.length - 2) / 2}, ` +
          `chainLen=${(chainBody.length - 2) / 2})`,
      );
    }
  }
  return results;
}

export function publicClientForManifestChain(
  chainId: number,
  rpcUrl?: string,
): PublicClient {
  const url =
    rpcUrl ??
    (chainId === 11155111
      ? process.env.ETH_SEPOLIA_RPC_URL ??
        "https://ethereum-sepolia-rpc.publicnode.com"
      : process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");
  return createPublicClient({ transport: http(url) });
}
