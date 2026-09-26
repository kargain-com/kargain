/**
 * Profile subject honesty — commercial-namespace handle resolves to a shell;
 * unserved sections refuse with product_owner_owed; notFound only for non-subjects.
 * Session profile entry uses profileHrefForAccount (not requireEvmSession).
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
  profileHrefForAccount,
  resolveProfileSubject,
} from "@/lib/profile/resolve-profile-subject";
import {
  DISCONNECTED_ACCOUNT,
  type ActiveAccount,
} from "@/lib/web3/active-account";
import { mintKargainNamespace } from "@/lib/web3/kargain-namespace";
import { surfaceSupportCauseCopy } from "@/lib/web3/surface-support";
import { COMMERCIAL_ACTIVE } from "@/lib/web3/commercial-active";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOLANA_NS = 2_000_040_168;
const PROFILE_ROUTE = "app/(identity)/profile/[handle]/page.tsx";
const WALLET_LOGIN = "components/wallet-login-button.tsx";
const MOBILE_NAV = "components/shell/mobile-bottom-nav.tsx";

/** Valid base58 pubkey that is not a commercial stack identity field on live Solana. */
const SAMPLE_SVM_OWNER = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const EVM_EOA = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const SVM_ACCOUNT: ActiveAccount = {
  status: "connected",
  vm: "svm",
  address: SAMPLE_SVM_OWNER,
};

const EVM_ACCOUNT: ActiveAccount = {
  status: "connected",
  vm: "evm",
  address: EVM_EOA,
  namespace: mintKargainNamespace(84532),
  chainId: 84532,
};

/** Old gate: profile href only when requireEvmSession succeeds. */
const EVM_OK_PROFILE_HREF_PLANT =
  "const profileHref = evm.ok ? `/profile/${evm.address}` : null;";

/** Old mobile feed: Profile tab address only from EVM session. */
const EVM_OK_MOBILE_ADDRESS_PLANT = [
  "const evm = requireEvmSession(account);",
  "const address = evm.ok ? evm.address : undefined;",
  "const isConnected = evm.ok;",
].join("\n");

function entryGateViolationInSource(rel: string, source: string): string | false {
  if (/evm\.ok\s*\?\s*[`'"]\/profile\//.test(source)) {
    return `${rel}: profile href gated on evm.ok (use profileHrefForAccount)`;
  }
  if (
    rel === MOBILE_NAV &&
    /const\s+address\s*=\s*evm\.ok\s*\?\s*evm\.address/.test(source)
  ) {
    return `${rel}: Profile tab address from evm.ok (use connectedAddress + profileHrefForAccount)`;
  }
  if (
    rel === MOBILE_NAV &&
    /const\s+isConnected\s*=\s*evm\.ok\b/.test(source) &&
    /ProfileNavTab/.test(source) &&
    !/badgesConnected/.test(source)
  ) {
    return `${rel}: Profile tab isConnected = evm.ok (use profileHrefForAccount)`;
  }
  return false;
}

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

  it("protocol / program identity → absent; deployer EOA is a subject (SPEC II.4.1)", () => {
    const passport = COMMERCIAL_ACTIVE[84532]!.karPassport;
    assert.equal(resolveProfileSubject(passport).status, "absent");

    const svmPassport = COMMERCIAL_ACTIVE[SOLANA_NS]!.karPassport;
    assert.equal(resolveProfileSubject(svmPassport).status, "absent");

    const svmMode = COMMERCIAL_ACTIVE[SOLANA_NS]!.fixedPriceConsignment;
    assert.ok(svmMode);
    assert.equal(resolveProfileSubject(svmMode).status, "absent");

    const svmUsdc = COMMERCIAL_ACTIVE[SOLANA_NS]!.usdc;
    assert.ok(svmUsdc);
    assert.equal(resolveProfileSubject(svmUsdc).status, "absent");

    const svmDeployer = COMMERCIAL_ACTIVE[SOLANA_NS]!.deployer;
    const svmSubject = resolveProfileSubject(svmDeployer);
    assert.equal(svmSubject.status, "found");
    if (svmSubject.status === "found") {
      assert.equal(svmSubject.owner, svmDeployer);
    }
    assert.equal(
      profileHrefForAccount({
        status: "connected",
        vm: "svm",
        address: svmDeployer,
      }),
      `/profile/${encodeURIComponent(svmDeployer)}`,
    );

    const evmDeployer = COMMERCIAL_ACTIVE[84532]!.deployer;
    assert.equal(resolveProfileSubject(evmDeployer).status, "found");

    const evmTimelock = COMMERCIAL_ACTIVE[84532]!.timelock;
    assert.equal(
      resolveProfileSubject(evmTimelock).status,
      "absent",
      "EVM TimelockController is a protocol contract, not a person",
    );
  });

  it("constructed: governance roles coinciding must not denylist a person", () => {
    // Plant of the pre-fix defect: treating deployer/UA/timelock as stack identity.
    const roleFields = [
      "deployer",
      "upgradeAuthority",
      "timelock",
      "forfeitRecipient",
      "platformRecipient",
    ] as const;
    const ownerSrc = fs.readFileSync(
      path.join(ROOT, "lib/profile/resolve-profile-subject.ts"),
      "utf8",
    );
    const fieldsFn = ownerSrc.slice(
      ownerSrc.indexOf("function stackIdentityAddressFields"),
      ownerSrc.indexOf("export function isCommercialProtocolOwner"),
    );
    for (const field of roleFields) {
      assert.doesNotMatch(
        fieldsFn,
        new RegExp(`push\\(stack\\.${field}\\)`),
        `stackIdentityAddressFields must not push stack.${field} (SPEC II.4.1)`,
      );
    }
    assert.match(fieldsFn, /push\(stack\.karPassport\)/);
    assert.match(fieldsFn, /push\(stack\.fixedPriceConsignment\)/);
  });
});

describe("profileHrefForAccount (session entry)", () => {
  it("SVM session → base58 profile href (desktop and mobile share owner)", () => {
    const href = profileHrefForAccount(SVM_ACCOUNT);
    assert.equal(
      href,
      `/profile/${encodeURIComponent(SAMPLE_SVM_OWNER)}`,
    );
    assert.ok(href != null, "My profile / Profile tab must be present");
  });

  it("EVM session → today's checksum profile href", () => {
    const href = profileHrefForAccount(EVM_ACCOUNT);
    assert.equal(href, `/profile/${EVM_EOA}`);
    const subject = resolveProfileSubject(EVM_EOA);
    assert.equal(subject.status, "found");
    if (subject.status !== "found") return;
    assert.equal(href, `/profile/${encodeURIComponent(subject.owner)}`);
  });

  it("disconnected → null (Connect / no menu item)", () => {
    assert.equal(profileHrefForAccount(DISCONNECTED_ACCOUNT), null);
  });

  it("constructed: old evm.ok profile href gate is red; live entry chrome green", () => {
    assert.ok(
      entryGateViolationInSource(WALLET_LOGIN, EVM_OK_PROFILE_HREF_PLANT),
      "planted evm.ok profileHref must be detected",
    );
    assert.ok(
      entryGateViolationInSource(MOBILE_NAV, EVM_OK_MOBILE_ADDRESS_PLANT),
      "planted mobile evm.ok address feed must be detected",
    );

    for (const rel of [WALLET_LOGIN, MOBILE_NAV] as const) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      assert.equal(
        entryGateViolationInSource(rel, src),
        false,
        `${rel} must not gate profile entry on evm.ok`,
      );
      assert.match(src, /profileHrefForAccount/);
    }
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
