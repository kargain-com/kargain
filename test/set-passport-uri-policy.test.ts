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
  preparePassportEditWrite,
} from "@/lib/passport/prepare-passport-edit-write";
import {
  commercialSvmNamespaceIds,
  requireSvmCommercialActive,
} from "@/lib/web3/commercial-active";
import { mintKargainNamespace } from "@/lib/web3/kargain-namespace";
import type { SvmSignAndSendPort } from "@/lib/web3/svm-write-adapter";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import {
  txWriteAvailability,
  txWriteRefusalTitle,
} from "@/lib/web3/tx-write-availability";
import { wrongVmActionCopy } from "@/lib/web3/active-account";
import {
  vmBranchViolationInSource,
  VM_BRANCH_ALLOWLIST,
} from "./network-vm-component-policy.test.ts";
import { scanProductSources } from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/passport/set-passport-uri.ts";
const PREP_REL = "lib/passport/prepare-passport-edit-write.ts";
const WIZARD_REL = "components/passport/edit-passport-wizard.tsx";
const FOREIGN_READER_REL = "lib/svm/foreign-programs.ts";
const FOREIGN_MANIFEST_REL =
  "svm/crates/kargain-ix-wire/foreign-programs.manifest.json";
const TX_WRITE_REFUSAL_REL = "components/shell/tx-write-refusal.tsx";

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
    assert.match(src, /preparePassportEditWrite/);
    assert.match(src, /TxWriteRefusal/);
    assert.match(src, /txWriteAvailability/);
    assert.doesNotMatch(src, /\bensureSiweSession\b/);
    assert.equal(vmBranchViolationInSource(src), false);
  });

  /**
   * U6.1 inverted in place: the panel no longer refuses SVM sessions before the
   * set-URI owner. Same file, same case identity, flipped assertion vs U6.0-fix.
   */
  it("edit wizard no longer gates on requireEvmSession — SVM session can reach setPassportUri (U6.1 inverted in place)", () => {
    function wizardGatesOnEvmSession(source: string): boolean {
      return (
        /\brequireEvmSession\s*\(\s*account\s*\)/.test(source) &&
        /if\s*\(\s*!evm\.ok\s*\)\s*\{[\s\S]*?\bEvmSessionRefusal\b/.test(source)
      );
    }

    const live = wizardSource();
    assert.equal(
      wizardGatesOnEvmSession(live),
      false,
      "live wizard must not gate on requireEvmSession + EvmSessionRefusal",
    );
    assert.match(live, /txWriteAvailability\s*\(\s*account\s*,\s*chainId\s*\)/);
    assert.match(live, /TxWriteRefusal/);
    assert.doesNotMatch(live, /\brequireEvmSession\b/);
    assert.doesNotMatch(live, /\bEvmSessionRefusal\b/);

    // Planted change: restore the old EVM-only gate — must turn the inverted pin red.
    const planted = `${live}
const evm = requireEvmSession(account);
if (!evm.ok) {
  return <EvmSessionRefusal cause={evm.cause} />;
}
`;
    assert.equal(
      wizardGatesOnEvmSession(planted),
      true,
      "planted requireEvmSession + EvmSessionRefusal must turn the inverted pin red",
    );
  });

  it("SVM session admitted by write availability reaches executeSetPassportUri via named prep", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0, "live SVM commercial row required");
    const ns = namespaces[0]!;
    const owner = "So11111111111111111111111111111111111111112";
    const account = {
      status: "connected" as const,
      vm: "svm" as const,
      address: owner,
    };

    const avail = txWriteAvailability(account, ns);
    assert.equal(avail.available, true);
    if (!avail.available) throw new Error("expected available");
    assert.equal(avail.vm, "svm");

    const order: string[] = [];
    const prep = await preparePassportEditWrite({
      account,
      targetChainId: ns,
      switchChain: async () => {
        order.push("switch");
      },
      signMessageAsync: async () => {
        order.push("siwe");
        return "0x" as `0x${string}`;
      },
      ensureSiweSession: async () => {
        order.push("siwe");
      },
    });
    assert.deepEqual(prep, { ok: true, prep: "svm_none_required" });
    assert.deepEqual(order, [], "SVM prep must not switch or SIWE");

    let wireSeen = false;
    const port: SvmSignAndSendPort = {
      async signAndSendTransaction() {
        wireSeen = true;
        return new Uint8Array(64).fill(9);
      },
    };
    const sig = await executeSetPassportUri({
      account,
      chainId: ns,
      tokenId: "1",
      uri: "ar://u61-reach",
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

  it("EVM prep switches chain then SIWE before evm_prepared; planted omissions red", async () => {
    const account = {
      status: "connected" as const,
      vm: "evm" as const,
      address: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      namespace: mintKargainNamespace(84532),
      chainId: 11155111,
    };
    const targetChainId = 84532;

    async function runPrep(opts: {
      switch?: boolean;
      siwe?: boolean;
    }): Promise<{ order: string[]; prep: Awaited<ReturnType<typeof preparePassportEditWrite>> }> {
      const order: string[] = [];
      const prep = await preparePassportEditWrite({
        account,
        targetChainId,
        switchChain: async (id) => {
          if (opts.switch === false) return;
          order.push("switch");
          assert.equal(id, wagmiChainId(targetChainId));
        },
        signMessageAsync: async () => "0xdead" as `0x${string}`,
        ensureSiweSession: async () => {
          if (opts.siwe === false) return;
          order.push("siwe");
        },
      });
      return { order, prep };
    }

    const live = await runPrep({});
    assert.deepEqual(live.prep, { ok: true, prep: "evm_prepared" });
    assert.deepEqual(live.order, ["switch", "siwe"]);

    // Planted: omit chain switch when wallet chain differs → order pin red.
    const noSwitch = await runPrep({ switch: false });
    assert.throws(() => {
      assert.deepEqual(noSwitch.order, ["switch", "siwe"]);
    });

    // Planted: omit SIWE → order pin red.
    const noSiwe = await runPrep({ siwe: false });
    assert.throws(() => {
      assert.deepEqual(noSiwe.order, ["switch", "siwe"]);
    });
  });

  it("txWriteRefusalTitle never lets disconnectedTitle override wrong_vm", () => {
    const editDisconnected = "Connect wallet to edit this passport.";
    const wrongVm: { available: false; cause: "wrong_vm"; wanted: "evm" } = {
      available: false,
      cause: "wrong_vm",
      wanted: "evm",
    };
    const disconnected: { available: false; cause: "disconnected" } = {
      available: false,
      cause: "disconnected",
    };
    assert.equal(
      txWriteRefusalTitle(wrongVm, editDisconnected),
      wrongVmActionCopy("evm"),
    );
    assert.equal(
      txWriteRefusalTitle(disconnected, editDisconnected),
      editDisconnected,
    );

    const plantedBroken = (
      refusal: typeof wrongVm | typeof disconnected,
      override?: string,
    ) => override ?? txWriteRefusalTitle(refusal);
    assert.equal(
      plantedBroken(wrongVm, editDisconnected),
      editDisconnected,
      "control: ungated override would lie to a wrong-family session",
    );
    assert.notEqual(
      txWriteRefusalTitle(wrongVm, editDisconnected),
      editDisconnected,
    );

    const chrome = readFileSync(path.join(ROOT, TX_WRITE_REFUSAL_REL), "utf8");
    assert.match(chrome, /txWriteRefusalTitle/);
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

  it("VM branch allowlist includes set-uri + prep owners; app/components/hooks stay empty of forks", () => {
    assert.ok(
      (VM_BRANCH_ALLOWLIST as readonly string[]).includes(OWNER_REL),
      "set-passport-uri must be on VM_BRANCH_ALLOWLIST",
    );
    assert.ok(
      (VM_BRANCH_ALLOWLIST as readonly string[]).includes(PREP_REL),
      "prepare-passport-edit-write must be on VM_BRANCH_ALLOWLIST",
    );
    const violations = scanProductSources((rel, source) => {
      if ((VM_BRANCH_ALLOWLIST as readonly string[]).includes(rel)) return false;
      if (!vmBranchViolationInSource(source)) return false;
      return `vm / stack.vm branch outside allowlist (${rel})`;
    });
    assert.deepEqual(violations, []);
  });
});
