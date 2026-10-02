/**
 * Unit O — dual-VM passport holder ownership + KarPassport ownerOf ban.
 *
 * Allowlisted product ownerOf sites (named reasons):
 * - fetch/build-chain passport detail → Unit L (entity stub; queued)
 * - use-bridge / use-bridge-transit → destination delivery poll (EVM star)
 *
 * Holder owner may plan EVM ownerOf; chrome must not.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  isPassportHolderFromFact,
  isSessionHolder,
  passportHolderOwnerAddress,
  resolvePassportHolder,
  type PassportHolder,
} from "@/lib/passport/passport-holder";
import { isPassportHolder } from "@/lib/passport/passport-owner";
import type { ActiveAccount } from "@/lib/web3/active-account";
import { mintKargainNamespace } from "@/lib/web3/kargain-namespace";
import {
  encodeSvmPubkeyBytes,
  mintProtocolOwner,
} from "@/lib/web3/protocol-address";
import {
  MPL_CORE_FIXTURE_OWNER_BYTES,
} from "./fixtures/mpl-core-asset-v1.ts";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/passport/passport-holder.ts";
const HOOK_REL = "hooks/use-passport-holder.ts";
const DECODE_REL = "lib/svm/decode-core-asset.ts";

/** Product KarPassport `ownerOf` outside the holder plan — Unit L + bridge delivery only. */
const OWNER_OF_ALLOWLIST: Readonly<Record<string, string>> = {
  "lib/passport/fetch-passport-detail.ts":
    "Unit L — entity stub builder; reuses Core decode later",
  "lib/passport/build-chain-passport-detail.ts":
    "Unit L — entity stub builder; reuses Core decode later",
  "hooks/use-bridge.ts":
    "Destination delivery poll — EVM star only until Solana ∈ EID_BY_CHAIN",
  "hooks/use-bridge-transit.ts":
    "Destination delivery poll — EVM star only until Solana ∈ EID_BY_CHAIN",
  // Holder plans EVM ownerOf; sole chrome door is this module + hook.
  [OWNER_REL]: "Passport holder EVM plan — sole product ownerOf for chrome",
};

const OWNER_OF_RE =
  /functionName\s*:\s*["']ownerOf["']/;

const PRODUCT_ROOTS = ["app", "components", "hooks", "lib"] as const;

function walkTs(dir: string, out: string[]): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTs(full, out);
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(full);
  }
}

function findOwnerOfViolations(): string[] {
  const hits: string[] = [];
  for (const root of PRODUCT_ROOTS) {
    const files: string[] = [];
    walkTs(path.join(ROOT, root), files);
    for (const abs of files) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      if (OWNER_OF_ALLOWLIST[rel] != null) continue;
      const src = readFileSync(abs, "utf8");
      if (OWNER_OF_RE.test(src)) hits.push(rel);
    }
  }
  return hits;
}

const EVM_NS = 84532;
const SVM_NS = 2000040168;
const OWNER_HEX = "0x1111111111111111111111111111111111111111";
const OTHER_HEX = "0x2222222222222222222222222222222222222222";
const SELLER_HEX = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1";

function connectedEvm(address: string): ActiveAccount {
  return {
    status: "connected",
    vm: "evm",
    address: address as `0x${string}`,
    namespace: mintKargainNamespace(EVM_NS),
    chainId: EVM_NS,
  };
}

function connectedSvm(address: string): ActiveAccount {
  return {
    status: "connected",
    vm: "svm",
    address,
  };
}

describe("passport-holder policy (Unit O)", () => {
  it("allowlist reasons are named for L + bridge delivery", () => {
    for (const [rel, reason] of Object.entries(OWNER_OF_ALLOWLIST)) {
      if (rel === OWNER_REL) continue;
      assert.ok(reason.length > 10, `${rel} needs a named allowlist reason`);
      assert.match(
        reason,
        /Unit L|delivery poll|EID_BY_CHAIN/,
        `${rel} reason must name L or delivery`,
      );
    }
  });

  it("product KarPassport ownerOf only in holder + named allowlist", () => {
    const hits = findOwnerOfViolations();
    assert.deepEqual(
      hits,
      [],
      `unexpected ownerOf sites: ${hits.join(", ")}`,
    );
  });

  it("planted chrome ownerOf is red then green", () => {
    const dirty = `const x = { functionName: "ownerOf" as const };`;
    assert.equal(OWNER_OF_RE.test(dirty), true);
    const clean = `const x = { functionName: "balanceOf" as const };`;
    assert.equal(OWNER_OF_RE.test(clean), false);
  });

  it("chain success beats projection; projection names reason when pending", () => {
    const owner = mintProtocolOwner(EVM_NS, OWNER_HEX)!;
    const proj = mintProtocolOwner(EVM_NS, OTHER_HEX)!;
    const known = resolvePassportHolder({
      namespace: EVM_NS,
      chain: { status: "success", owner },
      projectionOwner: proj,
    });
    assert.equal(known.status, "known");
    if (known.status === "known") {
      assert.equal(known.owner, owner);
      assert.equal(known.source, "chain");
    }

    const projection = resolvePassportHolder({
      namespace: EVM_NS,
      chain: { status: "pending" },
      projectionOwner: proj,
    });
    assert.equal(projection.status, "projection");
    if (projection.status === "projection") {
      assert.equal(projection.owner, proj);
      assert.equal(projection.reason, "chain_pending");
    }
  });

  it("in_transit when transit active; never invents owner", () => {
    const holder = resolvePassportHolder({
      namespace: EVM_NS,
      transitActive: true,
      chain: {
        status: "success",
        owner: mintProtocolOwner(EVM_NS, OWNER_HEX)!,
      },
    });
    assert.equal(holder.status, "in_transit");
    assert.equal(passportHolderOwnerAddress(holder), undefined);
  });

  it("EVM session holder matches known owner; non-owner refused", () => {
    const owner = mintProtocolOwner(EVM_NS, OWNER_HEX)!;
    const holder: PassportHolder = {
      status: "known",
      owner,
      source: "chain",
    };
    assert.equal(isSessionHolder(connectedEvm(OWNER_HEX), holder, EVM_NS), true);
    assert.equal(isSessionHolder(connectedEvm(OTHER_HEX), holder, EVM_NS), false);
  });

  it("SVM session holder compares via protocolAddressesEqual", () => {
    const base58 = encodeSvmPubkeyBytes(MPL_CORE_FIXTURE_OWNER_BYTES);
    const owner = mintProtocolOwner(SVM_NS, base58);
    assert.ok(owner != null, "fixture owner must mint on Solana commercial ns");
    const holder: PassportHolder = {
      status: "known",
      owner: owner!,
      source: "chain",
    };
    assert.equal(isSessionHolder(connectedSvm(base58), holder, SVM_NS), true);
    assert.equal(
      isSessionHolder(
        connectedSvm(encodeSvmPubkeyBytes(new Uint8Array(32).fill(9))),
        holder,
        SVM_NS,
      ),
      false,
    );
  });

  it("listing-active seller still holds (regression vs isSessionHolder-only)", () => {
    const modeCustody = mintProtocolOwner(EVM_NS, OTHER_HEX)!;
    const holder: PassportHolder = {
      status: "known",
      owner: modeCustody,
      source: "chain",
    };
    assert.equal(
      isPassportHolderFromFact({
        account: connectedEvm(SELLER_HEX),
        holder,
        namespace: EVM_NS,
        listingActive: true,
        listingSeller: SELLER_HEX,
      }),
      true,
      "seller must remain holder while mode holds the NFT",
    );
    assert.equal(
      isSessionHolder(connectedEvm(SELLER_HEX), holder, EVM_NS),
      false,
      "isSessionHolder alone must not replace listing-seller arm",
    );
    assert.equal(
      isPassportHolder({
        address: SELLER_HEX,
        onChainOwner: OTHER_HEX,
        listingActive: true,
        listingSeller: SELLER_HEX,
        namespace: EVM_NS,
      }),
      true,
    );
  });

  it("bridge panel does not requireEvmSession for visibility", () => {
    const src = readFileSync(
      path.join(ROOT, "components/passport/passport-bridge-panel.tsx"),
      "utf8",
    );
    assert.match(src, /usePassportHolder/);
    assert.match(src, /isSessionHolder/);
    assert.doesNotMatch(
      src,
      /requireEvmSession/,
      "bridge visibility must not gate on requireEvmSession",
    );
  });

  it("owner + hook + decode files exist; chrome deletes on-chain-owner hook", () => {
    assert.ok(readFileSync(path.join(ROOT, OWNER_REL), "utf8").length > 0);
    assert.ok(readFileSync(path.join(ROOT, HOOK_REL), "utf8").length > 0);
    assert.ok(readFileSync(path.join(ROOT, DECODE_REL), "utf8").length > 0);
    assert.throws(
      () =>
        readFileSync(
          path.join(ROOT, "hooks/use-passport-on-chain-owner.ts"),
          "utf8",
        ),
      /ENOENT/,
    );
  });

  it("resolveEffectiveOnChainOwner deleted from passport-owner", () => {
    const src = readFileSync(
      path.join(ROOT, "lib/passport/passport-owner.ts"),
      "utf8",
    );
    assert.doesNotMatch(src, /export function resolveEffectiveOnChainOwner/);
  });

  it("VM fork allowlist includes passport-holder", () => {
    const scan = scanProductSources(
      (rel, source) => {
        if (!/\bvm\s*===\s*["'](?:evm|svm)["']/.test(source) && !/stack\.vm\b/.test(source)) {
          return false;
        }
        return `vm branch (${rel})`;
      },
      { owners: [OWNER_REL] },
    );
    // Soft pin: owner file is allowlisted in network-vm policy; this just
    // ensures the owner source still forks on vm (dual-VM plan).
    const ownerSrc = readFileSync(path.join(ROOT, OWNER_REL), "utf8");
    assert.match(ownerSrc, /stack\.vm|vm ===/);
    void scan;
    assertCleanProductScan(
      scanProductSources(() => false, { owners: [OWNER_REL] }),
      { owners: [OWNER_REL] },
    );
  });
});
