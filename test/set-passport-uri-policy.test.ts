/**
 * §7.2 U6 — passport set-URI write owner: EVM pin, SVM metas order, composition.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { AccountRole, getBase58Decoder } from "@solana/kit";

import {
  tokenIdFromBytes32,
  tokenIdToBytes32,
} from "@/lib/svm/event-payload-decode";
import {
  foreignProgramEntries,
  mplCoreProgramId,
  systemProgramId,
} from "@/lib/svm/foreign-programs";
import {
  buildEvmSetPassportUriCall,
  executeSetPassportUri,
  planSetPassportUri,
} from "@/lib/passport/set-passport-uri";
import {
  commercialSvmNamespaceIds,
  requireSvmCommercialActive,
} from "@/lib/web3/commercial-active";
import { mintKargainNamespace } from "@/lib/web3/kargain-namespace";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import {
  vmBranchViolationInSource,
  VM_BRANCH_ALLOWLIST,
} from "./network-vm-component-policy.test.ts";
import { scanProductSources } from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/passport/set-passport-uri.ts";
const WIZARD_REL = "components/passport/edit-passport-wizard.tsx";
const FOREIGN_READER_REL = "lib/svm/foreign-programs.ts";
const FOREIGN_MANIFEST_REL =
  "svm/crates/kargain-ix-wire/foreign-programs.manifest.json";

const MOCK_BLOCKHASH = getBase58Decoder().decode(new Uint8Array(32).fill(7));

function ownerSource(): string {
  return readFileSync(path.join(ROOT, OWNER_REL), "utf8");
}

function wizardSource(): string {
  return readFileSync(path.join(ROOT, WIZARD_REL), "utf8");
}

function assertEvmCallPin(
  call: {
    functionName: string;
    args: readonly unknown[];
  },
  tokenId: string,
  uri: string,
): void {
  assert.equal(call.functionName, "setPassportURI");
  assert.deepEqual(call.args, [BigInt(tokenId), uri]);
}

describe("tokenIdToBytes32 round-trip", () => {
  const edges = [
    "0",
    "1",
    "28764749040560770193485982315422230450798602",
    ((1n << 256n) - 1n).toString(),
  ];

  for (const tokenId of edges) {
    it(`round-trips ${tokenId === "0" ? "zero" : tokenId.length > 20 ? "large/max" : tokenId}`, () => {
      const bytes = tokenIdToBytes32(tokenId);
      assert.equal(bytes.length, 32);
      assert.equal(tokenIdFromBytes32(bytes), tokenId);
    });
  }
});

describe("foreign-programs reader", () => {
  it("serves mpl_core and system from the committed sibling manifest", () => {
    const entries = foreignProgramEntries();
    assert.equal(entries.length, 2);
    assert.equal(mplCoreProgramId(), "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
    assert.equal(systemProgramId(), "11111111111111111111111111111111");
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, FOREIGN_MANIFEST_REL), "utf8"),
    ) as { programs: Array<{ id: string; address: string }> };
    assert.equal(mplCoreProgramId(), manifest.programs[0]!.address);
    assert.equal(systemProgramId(), manifest.programs[1]!.address);
  });

  it("product lib has no web3.js SystemProgram and no literal Core id outside the reader", () => {
    const violations = scanProductSources((rel, source) => {
      if (rel === FOREIGN_READER_REL) return false;
      if (/\bSystemProgram\.programId\b/.test(source)) {
        return `SystemProgram.programId outside foreign-programs (${rel})`;
      }
      if (
        source.includes("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d") &&
        !rel.includes("foreign-programs")
      ) {
        return `mpl_core literal outside foreign-programs (${rel})`;
      }
      return false;
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });
});

describe("setPassportUri EVM behavioural pin", () => {
  const tokenId = "42";
  const uri = "ar://edited";

  it("buildEvmSetPassportUriCall yields setPassportURI with [BigInt(tokenId), uri]", () => {
    const address = karPassportAddress(84532);
    assert.ok(address);
    const call = buildEvmSetPassportUriCall({
      address,
      tokenId,
      uri,
      chainId: 84532,
    });
    assertEvmCallPin(call, tokenId, uri);
    assert.equal(call.chainId, wagmiChainId(84532));
    assert.equal(call.address, address);
  });

  it("planSetPassportUri EVM arm matches today's call for live hub", async () => {
    const address = karPassportAddress(84532);
    assert.ok(address);
    const planned = await planSetPassportUri({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      tokenId,
      uri,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "evm") throw new Error("expected evm plan");
    assertEvmCallPin(planned.call, tokenId, uri);
  });

  it("planted wrong functionName is red; live builder is green", () => {
    const address = karPassportAddress(84532)!;
    const live = buildEvmSetPassportUriCall({
      address,
      tokenId,
      uri,
      chainId: 84532,
    });
    assertEvmCallPin(live, tokenId, uri);

    // Planted change: functionName: "setTokenURI"
    const planted = {
      ...live,
      functionName: "setTokenURI" as const,
    };
    assert.throws(() => {
      assertEvmCallPin(planted, tokenId, uri);
    });
  });

  it("planted deleted EVM arm is red; live owner source is green", () => {
    const live = ownerSource();
    assert.match(live, /buildEvmSetPassportUriCall/);
    assert.match(live, /functionName:\s*"setPassportURI"/);
    assert.match(live, /avail\.vm === "evm"/);

    // Planted change: strip the EVM builder and the avail.vm === "evm" arm.
    const planted = live
      .split("\n")
      .filter(
        (line) =>
          !line.includes("buildEvmSetPassportUriCall") &&
          !line.includes('functionName: "setPassportURI"') &&
          !line.includes('avail.vm === "evm"'),
      )
      .join("\n");
    assert.equal(/buildEvmSetPassportUriCall/.test(planted), false);
    assert.equal(/functionName:\s*"setPassportURI"/.test(planted), false);
    assert.equal(/avail\.vm === "evm"/.test(planted), false);
    assert.equal(/buildEvmSetPassportUriCall/.test(live), true);
    assert.equal(/functionName:\s*"setPassportURI"/.test(live), true);
  });

  it("executeSetPassportUri EVM passes the pinned call through writeEvmContract", async () => {
    const address = karPassportAddress(84532)!;
    let captured: unknown;
    const hash = await executeSetPassportUri({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
      tokenId,
      uri,
      writeEvmContract: async (call) => {
        captured = call;
        return "0xabc" as `0x${string}`;
      },
    });
    assert.equal(hash, "0xabc");
    assert.ok(captured);
    assertEvmCallPin(
      captured as { functionName: string; args: readonly unknown[] },
      tokenId,
      uri,
    );
    assert.equal(
      (captured as { address: string }).address,
      address,
    );
  });
});

describe("setPassportUri SVM metas order", () => {
  it("seven accounts in processor order with derived roles", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0, "live SVM commercial row required");
    const ns = namespaces[0]!;
    const stack = requireSvmCommercialActive(ns);
    const owner =
      "So11111111111111111111111111111111111111112";
    const tokenId = "1";
    const uri = "ar://svm-edit";

    const planned = await planSetPassportUri({
      account: { status: "connected", vm: "svm", address: owner },
      chainId: ns,
      tokenId,
      uri,
    });
    assert.equal(planned.ok, true);
    if (!planned.ok || planned.vm !== "svm") throw new Error("expected svm plan");

    const accounts = planned.plan.accounts;
    assert.equal(accounts.length, 7);
    assert.equal(accounts[0]!.role, AccountRole.READONLY); // config
    assert.equal(accounts[1]!.role, AccountRole.WRITABLE); // asset
    assert.equal(accounts[2]!.role, AccountRole.WRITABLE); // state
    assert.equal(accounts[3]!.role, AccountRole.READONLY_SIGNER); // owner
    assert.equal(accounts[4]!.role, AccountRole.WRITABLE_SIGNER); // payer
    assert.equal(accounts[5]!.role, AccountRole.READONLY); // core
    assert.equal(accounts[6]!.role, AccountRole.READONLY); // system
    assert.equal(accounts[3]!.address, owner);
    assert.equal(accounts[4]!.address, owner);
    assert.equal(accounts[5]!.address, mplCoreProgramId());
    assert.equal(accounts[6]!.address, systemProgramId());
    assert.equal(planned.plan.programId, stack.karPassport);
    assert.equal(planned.plan.feePayer, owner);

    // Adjacent owner↔payer swap fails the same role pin (processor order).
    const swapped = [...accounts];
    const tmp = swapped[3]!;
    swapped[3] = swapped[4]!;
    swapped[4] = tmp;
    assert.throws(() => {
      assert.equal(swapped[3]!.role, AccountRole.READONLY_SIGNER);
      assert.equal(swapped[4]!.role, AccountRole.WRITABLE_SIGNER);
    });
  });

  it("executeSetPassportUri SVM sends assembled metas via sendSvmInstruction", async () => {
    const namespaces = commercialSvmNamespaceIds();
    const ns = namespaces[0]!;
    const owner = "So11111111111111111111111111111111111111112";
    let wireSeen = false;
    const port: SvmSignAndSendPort = {
      async signAndSendTransaction() {
        wireSeen = true;
        return new Uint8Array(64).fill(9);
      },
    };
    const sig = await executeSetPassportUri({
      account: { status: "connected", vm: "svm", address: owner },
      chainId: ns,
      tokenId: "1",
      uri: "ar://x",
      writeEvmContract: async () => {
        throw new Error("evm arm must not run");
      },
      svmPort: port,
      fetchBlockhash: async () =>
        ({
          ok: true as const,
          value: {
            blockhash: MOCK_BLOCKHASH,
            lastValidBlockHeight: 1_000_000n,
          },
        }) as const,
    });
    assert.equal(typeof sig, "string");
    assert.equal(sig.length > 0, true);
    assert.equal(wireSeen, true);
  });
});

describe("setPassportUri ownership + panel surface", () => {
  it("owner composes encode / derive / send / foreign-programs / tokenIdToBytes32", () => {
    const src = ownerSource();
    assert.match(src, /encodeSvmInstruction/);
    assert.match(src, /deriveSvmPda/);
    assert.match(src, /sendSvmInstruction/);
    assert.match(src, /mplCoreProgramId|systemProgramId/);
    assert.match(src, /tokenIdToBytes32/);
    assert.doesNotMatch(src, /@solana\/web3\.js/);
    assert.doesNotMatch(src, /from\s+["']@\/lib\/passport\/action-surface/);
    assert.doesNotMatch(src, /\bresolvePassportEditAccess\b/);
  });

  it("edit wizard has no functionName / writeContract / ABI / if(vm)", () => {
    const src = wizardSource();
    assert.doesNotMatch(src, /functionName/);
    assert.doesNotMatch(src, /writeContract/);
    assert.doesNotMatch(src, /KarPassportAbi/);
    assert.doesNotMatch(src, /useEvmWriteContract/);
    assert.match(src, /useSetPassportUri/);
    assert.match(src, /setPassportUri\(\{\s*chainId,\s*tokenId,\s*uri\s*\}\)/);
    assert.equal(vmBranchViolationInSource(src), false);
  });

  /**
   * Known-incomplete: this panel still refuses SVM sessions before the set-URI
   * owner runs. Holds that limitation by name so U6.1 (session chrome) must
   * invert this pin in place — same file, same title, flipped assertion.
   */
  it("edit wizard still gates on requireEvmSession — SVM session cannot reach setPassportUri (U6.1 inverts this pin in place)", () => {
    function wizardGatesOnEvmSession(source: string): boolean {
      return (
        /\brequireEvmSession\s*\(\s*account\s*\)/.test(source) &&
        /if\s*\(\s*!evm\.ok\s*\)\s*\{[\s\S]*?\bEvmSessionRefusal\b/.test(source)
      );
    }

    const live = wizardSource();
    assert.equal(
      wizardGatesOnEvmSession(live),
      true,
      "live wizard must still gate on requireEvmSession + EvmSessionRefusal",
    );

    // Planted change: remove requireEvmSession(account) and the !evm.ok refusal.
    const planted = live
      .replace(/\brequireEvmSession\s*\(\s*account\s*\)/g, "/* planted: no requireEvmSession */ null")
      .replace(
        /if\s*\(\s*!evm\.ok\s*\)\s*\{[\s\S]*?\bEvmSessionRefusal\b[\s\S]*?\n\s*\}\n/,
        "/* planted: no EvmSessionRefusal gate */\n",
      );
    assert.equal(
      wizardGatesOnEvmSession(planted),
      false,
      "planted gate removal must turn the limitation pin red",
    );
  });

  it("planted if(vm) in wizard is red; live wizard is green", () => {
    const live = wizardSource();
    assert.equal(vmBranchViolationInSource(live), false);

    const planted = `
${live}
if (account.vm === "svm") return null;
`;
    assert.equal(vmBranchViolationInSource(planted), true);
  });

  it("VM branch allowlist includes the set-uri owner; app/components/hooks stay empty of forks", () => {
    assert.ok(
      (VM_BRANCH_ALLOWLIST as readonly string[]).includes(OWNER_REL),
      "set-passport-uri must be on VM_BRANCH_ALLOWLIST",
    );
    const violations = scanProductSources((rel, source) => {
      if ((VM_BRANCH_ALLOWLIST as readonly string[]).includes(rel)) return false;
      if (!vmBranchViolationInSource(source)) return false;
      return `vm / stack.vm branch outside allowlist (${rel})`;
    });
    assert.deepEqual(violations, []);
  });
});
