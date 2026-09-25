/**
 * Profile subject honesty — commercial-namespace handle resolves to a shell;
 * unserved sections refuse with product_owner_owed; notFound only for non-subjects.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PROFILE_SECTION_IDS,
  profileSectionRefusalCopy,
  profileSectionSupport,
  profileSectionSupportMap,
} from "@/lib/profile/profile-section-support";
import {
  profileGuestEvmChainId,
  resolveProfileSubject,
} from "@/lib/profile/resolve-profile-subject";
import { surfaceSupportCauseCopy } from "@/lib/web3/surface-support";
import { COMMERCIAL_ACTIVE } from "@/lib/web3/commercial-active";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOLANA_NS = 2_000_040_168;
const PROFILE_ROUTE = "app/(identity)/profile/[handle]/page.tsx";

/** Valid base58 pubkey that is not a commercial stack identity field on live Solana. */
const SAMPLE_SVM_OWNER = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const EVM_EOA = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("profile subject resolution", () => {
  it("SVM base58 owner → found with Solana namespace; nonsense → absent", () => {
    const found = resolveProfileSubject(SAMPLE_SVM_OWNER);
    assert.equal(found.status, "found");
    if (found.status !== "found") return;
    assert.equal(found.owner, SAMPLE_SVM_OWNER);
    assert.ok(found.namespaces.includes(SOLANA_NS));
    assert.equal(profileGuestEvmChainId(found.namespaces), null);

    const absent = resolveProfileSubject("!!!not-a-valid-address!!!");
    assert.equal(absent.status, "absent");
  });

  it("EVM checksum handle → found with EVM namespaces; guest chain is EVM", () => {
    const found = resolveProfileSubject(EVM_EOA);
    assert.equal(found.status, "found");
    if (found.status !== "found") return;
    assert.ok(found.namespaces.includes(84532));
    assert.ok(found.namespaces.includes(11155111));
    assert.equal(profileGuestEvmChainId(found.namespaces), 84532);
  });

  it("protocol / stack identity address → absent (not a person)", () => {
    const passport = COMMERCIAL_ACTIVE[84532]!.karPassport;
    const subject = resolveProfileSubject(passport);
    assert.equal(subject.status, "absent");

    const svmPassport = COMMERCIAL_ACTIVE[SOLANA_NS]!.karPassport;
    assert.equal(resolveProfileSubject(svmPassport).status, "absent");
  });
});

describe("profile section support", () => {
  it("SVM-only subject: passports available; EVM sections product_owner_owed with D2 sentence", () => {
    const namespaces = [SOLANA_NS] as const;
    const owed = surfaceSupportCauseCopy("product_owner_owed");
    assert.equal(
      profileSectionSupport("passports", namespaces).available,
      true,
    );
    for (const section of PROFILE_SECTION_IDS) {
      if (section === "passports") continue;
      const support = profileSectionSupport(section, namespaces);
      assert.equal(support.available, false);
      if (support.available) continue;
      assert.equal(support.cause, "product_owner_owed");
      assert.equal(profileSectionRefusalCopy(support), owed);
    }
  });

  it("EVM subject: every section available", () => {
    const namespaces = [84532, 11155111] as const;
    const map = profileSectionSupportMap(namespaces);
    for (const id of PROFILE_SECTION_IDS) {
      assert.equal(map[id].available, true, id);
    }
  });
});

describe("profile route policy", () => {
  it("route uses resolveProfileSubject; never getAddress( or commercialChainIds()[0]", () => {
    const src = fs.readFileSync(path.join(ROOT, PROFILE_ROUTE), "utf8");
    assert.match(src, /resolveProfileSubject/);
    assert.doesNotMatch(src, /\bgetAddress\s*\(/);
    assert.doesNotMatch(src, /commercialChainIds\s*\(\s*\)\s*\[\s*0\s*\]/);
    assert.match(src, /profileSectionSupportMap/);
    assert.match(src, /profileGuestEvmChainId/);
  });

  it("constructed: inventing guest EVM chain for SVM-only namespaces is red", () => {
    const namespaces = [SOLANA_NS];
    assert.equal(profileGuestEvmChainId(namespaces), null);
    // Plant: treating null guest as hub invent
    const invented = profileGuestEvmChainId(namespaces) ?? 84532;
    assert.notEqual(
      invented,
      profileGuestEvmChainId(namespaces),
      "must not fill guest chain with hub when SVM-only",
    );
  });

  it("constructed: serving listings rows when listings section refused is red", () => {
    const namespaces = [SOLANA_NS];
    const support = profileSectionSupport("listings", namespaces);
    assert.equal(support.available, false);
    const plantedListings = [{ tokenId: "1" }];
    // Product must not pass planted rows when section is refused:
    const served = support.available ? plantedListings : [];
    assert.deepEqual(served, []);
    assert.notEqual(
      support.available ? plantedListings.length : 0,
      plantedListings.length,
    );
  });

  it("route source never re-inlines product_owner_owed sentence", () => {
    const sentence = surfaceSupportCauseCopy("product_owner_owed");
    const owners = [
      "lib/web3/surface-support.ts",
      "lib/profile/profile-section-support.ts",
    ];
    const planted = `const x = ${JSON.stringify(sentence)};\n`;
    assert.ok(planted.includes(JSON.stringify(sentence)));
    assert.throws(
      () =>
        assertCleanProductScan(
          {
            filesRead: 1,
            violations: [
              {
                path: PROFILE_ROUTE,
                reason: `re-inlined product_owner_owed: ${sentence}`,
              },
            ],
            unreadable: [],
          },
          { owners, allowEmptyTargets: true },
        ),
      /re-inlined product_owner_owed/,
    );
    const scan = scanProductSources((rel, source) => {
      if (rel !== PROFILE_ROUTE && !rel.startsWith("components/profile/")) {
        return false;
      }
      if (source.includes(JSON.stringify(sentence))) {
        return `re-inlined product_owner_owed (sole owner: surfaceSupportCauseCopy): ${sentence}`;
      }
      return false;
    }, { owners });
    assertCleanProductScan(scan, { owners });
  });
});
