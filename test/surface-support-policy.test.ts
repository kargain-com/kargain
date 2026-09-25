/**
 * S8-D0 — surface-support census + sole reader + behaviour-neutral composition.
 *
 * (a) derived → call-based map ⊆ census; floors; empty derivation red
 * (b)/(c) typed evidence present (A) / absent in scope (B)
 * (d) migrated owners × sessions × namespaces — ForCapability ≡ txWriteAvailability
 *
 * Negatives call the same live assert* helpers with in-memory plants (no assert.ok(false)).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ARCHITECTURAL_CHOKEPOINTS } from "@/lib/architecture/chokepoints";
import { COMMERCIAL_ACTIVE } from "@/lib/web3/commercial-active";
import { mintKargainNamespace } from "@/lib/web3/kargain-namespace";
import {
  SURFACE_CAPABILITIES,
  SURFACE_CLASS_C_CAPABILITIES,
  SURFACE_SUPPORT_CAUSES,
  SURFACE_SUPPORT_TABLE,
  surfaceClassOf,
  surfaceSupportCauseCopy,
  type SurfaceCapability,
  type SurfaceSupportTable,
} from "@/lib/web3/surface-support";
import {
  txWriteAvailability,
  txWriteAvailabilityForCapability,
} from "@/lib/web3/tx-write-availability";
import type { ActiveAccount } from "@/lib/web3/active-account";
import {
  SURFACE_CENSUS_CAPABILITY_META,
  SURFACE_CENSUS_PAIRS,
  type SurfaceCensusCapabilityMeta,
} from "./fixtures/surface-support-census.ts";
import {
  assertClassAEvidencePresent,
  assertCapabilityProgramBound,
  assertCorrespondenceEndsExtracted,
  assertCrossProgramCorrespondence,
  assertDerivationNonEmpty,
  assertDerivedPairsMapped,
  assertKindSafe,
  assertMatrixEqual,
  assertNoMechanismOwnerConsumers,
  assertNotInProgramAbsent,
  assertSessionGatesKnown,
  assertSvmEvmFamilyOnlyClassC,
  assertWriteCounterpartMatchesCell,
  buildCensusLookup,
  deriveClassBEvidence,
  loadScopedRustText,
  resolveProgramScopeRoots,
  boundProgramRelDir,
  type IxManifestLike,
  type StateManifestLike,
} from "./surface-support-assert.ts";
import {
  deriveMigratedTxWriteOwners,
  deriveSurfaceConsumerPairs,
  filesDefiningCensusPrimitives,
  loadLiveSurfaceSources,
  mechanismOwnerFiles,
  OWNER_PROSE_PATH_TOKEN_RE,
  SURFACE_SUPPORT_FLOORS,
  type SurfaceFileContents,
} from "./surface-support-derive.ts";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";
import {
  ABI_FN_TO_CAPABILITY,
  assertNoFragmentKeysInMap,
  capabilityFromMigratedOwnerSource,
  KNOWN_SESSION_GATES_WITHOUT_WRITES,
  mapSurfacePairsToCapabilities,
  SURFACE_CAPABILITY_KIND,
  SURFACE_CORRESPONDENCE,
} from "./surface-support-map.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const IX_MANIFEST = path.join(
  ROOT,
  "svm/crates/kargain-ix-wire/ix.manifest.json",
);
const STATE_MANIFEST = path.join(
  ROOT,
  "svm/crates/kargain-ix-wire/state.manifest.json",
);

function loadIxManifest(text?: string): IxManifestLike {
  const raw = text ?? fs.readFileSync(IX_MANIFEST, "utf8");
  const parsed = JSON.parse(raw) as {
    entries?: ReadonlyArray<{ name: string; enum: string }>;
  };
  if (!Array.isArray(parsed.entries)) {
    throw new Error("ix.manifest.json missing entries[]");
  }
  return {
    entries: parsed.entries.map((e) => ({ name: e.name, enum: e.enum })),
  };
}

function loadStateManifest(text?: string): StateManifestLike {
  const raw = text ?? fs.readFileSync(STATE_MANIFEST, "utf8");
  const parsed = JSON.parse(raw) as {
    layouts?: ReadonlyArray<{
      id?: string;
      name?: string;
      fields?: ReadonlyArray<{ name: string }>;
    }>;
  };
  if (Array.isArray(parsed)) {
    return {
      layouts: (
        parsed as ReadonlyArray<{
          id?: string;
          name?: string;
          fields?: ReadonlyArray<{ name: string }>;
        }>
      ).map((l) => ({
        id: l.id ?? l.name ?? "",
        fields: l.fields ?? [],
      })),
    };
  }
  return {
    layouts: (parsed.layouts ?? []).map((l) => ({
      id: l.id ?? l.name ?? "",
      fields: l.fields ?? [],
    })),
  };
}

function disconnectedAccount(): ActiveAccount {
  return { status: "disconnected" };
}

function evmSession(): ActiveAccount {
  return {
    status: "connected",
    vm: "evm",
    address: "0x0000000000000000000000000000000000000001",
    chainId: 84532,
    namespace: mintKargainNamespace(84532),
  };
}

function svmSession(): ActiveAccount {
  return {
    status: "connected",
    vm: "svm",
    address: "D87okZNVcTr7AAb9mnH6mBTwS9HRryhaq7XNLzUwxKCb",
  };
}

describe("surface-support policy (S8-D0)", () => {
  it("mechanism ownerFiles: unique primitive ownership + prose owners + existence", () => {
    const sources = loadLiveSurfaceSources();
    const defining = filesDefiningCensusPrimitives(sources);
    const ownerUnion = mechanismOwnerFiles();

    for (const cp of ARCHITECTURAL_CHOKEPOINTS) {
      if (cp.ownerFiles == null) continue;
      assert.equal(
        OWNER_PROSE_PATH_TOKEN_RE.test(cp.owner),
        false,
        `${cp.id}: owner prose must not contain path tokens: ${cp.owner}`,
      );
      for (const f of cp.ownerFiles) {
        assert.ok(
          sources.has(f) || fs.existsSync(path.join(ROOT, f)),
          `missing ownerFile ${f}`,
        );
        const defs = defining.get(f);
        assert.ok(
          defs != null && defs.length > 0,
          `ownerFile defines zero census primitives: ${f}`,
        );
      }
    }

    const primitiveToChokes = new Map<string, string[]>();
    for (const cp of ARCHITECTURAL_CHOKEPOINTS) {
      if (cp.ownerFiles == null) continue;
      for (const f of cp.ownerFiles) {
        for (const prim of defining.get(f) ?? []) {
          const list = primitiveToChokes.get(prim) ?? [];
          list.push(cp.id);
          primitiveToChokes.set(prim, list);
        }
      }
    }
    for (const [prim, chokes] of primitiveToChokes) {
      const unique = [...new Set(chokes)];
      assert.equal(
        unique.length,
        1,
        `census primitive ${prim} owned by ${unique.length} choke-points: ${unique.join(",")}`,
      );
    }

    assert.ok(ownerUnion.size >= 5, `ownerFiles union too small: ${ownerUnion.size}`);
  });

  it("planted bad ownerFiles (missing path / zero primitives) is red then green", () => {
    const sources = loadLiveSurfaceSources();
    const defining = filesDefiningCensusPrimitives(sources);
    assert.throws(
      () => {
        const plantedMissing = "lib/web3/does-not-exist-surface.ts";
        assert.ok(
          sources.has(plantedMissing),
          `missing ownerFile ${plantedMissing}`,
        );
      },
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        assert.match(err.message, /missing ownerFile/);
        return true;
      },
    );
    assert.throws(
      () => {
        const plantedEmpty = "lib/web3/commercial-active.ts";
        const defs = defining.get(plantedEmpty);
        assert.ok(
          defs != null && defs.length > 0,
          `ownerFile defines zero census primitives: ${plantedEmpty}`,
        );
      },
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        assert.match(err.message, /ownerFile defines zero census primitives/);
        return true;
      },
    );
    for (const f of mechanismOwnerFiles()) {
      const defs = filesDefiningCensusPrimitives(sources).get(f);
      assert.ok(defs != null && defs.length > 0, f);
    }
  });

  it("(a) derived pairs map by call; ⊆ census; session gates known; floors hold", () => {
    const sources = loadLiveSurfaceSources();
    const owners = mechanismOwnerFiles();
    const derived = deriveSurfaceConsumerPairs(sources);
    assertDerivationNonEmpty(derived);
    assert.ok(
      derived.length >= SURFACE_SUPPORT_FLOORS.derivedConsumerPairs,
      `empty or short derivation: got ${derived.length}`,
    );

    assertNoMechanismOwnerConsumers(derived, owners);

    const { mapped, sessionGatesWithoutWrites, unmappedContractCalls } =
      mapSurfacePairsToCapabilities(derived, sources);
    assert.equal(
      unmappedContractCalls.length,
      0,
      `unmapped contract calls: ${unmappedContractCalls
        .map((p) => `${p.file}:${p.functionName}:${p.abiId}`)
        .join("; ")}`,
    );

    const lookup = buildCensusLookup(SURFACE_CENSUS_PAIRS);
    assertDerivedPairsMapped(mapped, lookup);

    // Bidirectional: every census pair is in the mapped set
    const mappedKeys = new Set(
      mapped.map(
        (p) =>
          `${p.file}::${p.primitive}::${p.functionName ?? ""}::${p.capability}`,
      ),
    );
    for (const p of SURFACE_CENSUS_PAIRS) {
      const k = `${p.file}::${p.primitive}::${p.functionName ?? ""}::${p.capability}`;
      assert.ok(mappedKeys.has(k), `census pair not in live map: ${k}`);
    }

    assertSessionGatesKnown(
      sessionGatesWithoutWrites,
      KNOWN_SESSION_GATES_WITHOUT_WRITES,
    );

    const capIds = new Set(SURFACE_CENSUS_PAIRS.map((p) => p.capability));
    assert.ok(
      capIds.size >= SURFACE_SUPPORT_FLOORS.capabilities,
      `capability floor: got ${capIds.size}`,
    );

    const migrated = deriveMigratedTxWriteOwners(sources);
    assert.ok(
      migrated.length >= SURFACE_SUPPORT_FLOORS.migratedTxWriteOwners,
      `migrated txWrite owners floor ${SURFACE_SUPPORT_FLOORS.migratedTxWriteOwners}, got ${migrated.length}`,
    );
  });

  it("(a) empty derivation is red", () => {
    const empty = new Map() as SurfaceFileContents;
    const derived = deriveSurfaceConsumerPairs(empty);
    assert.equal(derived.length, 0);
    assert.throws(
      () => assertDerivationNonEmpty(derived),
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        assert.match(err.message, /derived consumer set must not be empty/);
        return true;
      },
    );
  });

  it("(a) planted unmapped consumer pair is red then green", () => {
    const sources = loadLiveSurfaceSources();
    const derived = deriveSurfaceConsumerPairs(sources);
    const { mapped } = mapSurfacePairsToCapabilities(derived, sources);
    const lookup = buildCensusLookup(SURFACE_CENSUS_PAIRS);
    const plant = {
      file: "lib/passport/set-passport-uri.ts",
      primitive: "useReadContract",
      functionName: "doesNotExist",
      abiId: "KarPassportAbi",
      capability: "set_passport_uri" as SurfaceCapability,
    };
    assert.throws(
      () => assertDerivedPairsMapped([...mapped, plant], lookup),
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        assert.match(
          err.message,
          /derived pair unmapped to capability: lib\/passport\/set-passport-uri\.ts::useReadContract::doesNotExist/,
        );
        return true;
      },
    );
    assertDerivedPairsMapped(mapped, lookup);
  });

  it("(a) mechanism-owner file planted as consumer is red then green", () => {
    const sources = loadLiveSurfaceSources();
    const owners = mechanismOwnerFiles();
    const derived = deriveSurfaceConsumerPairs(sources);
    const plantFile = [...owners][0]!;
    assert.throws(
      () =>
        assertNoMechanismOwnerConsumers(
          [
            ...derived,
            {
              file: plantFile,
              primitive: "requireEvmSession",
              functionName: null,
              abiId: null,
            },
          ],
          owners,
        ),
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        assert.match(err.message, /mechanism owner counted as consumer/);
        return true;
      },
    );
    assertNoMechanismOwnerConsumers(derived, owners);
  });

  it("(a) read primitive and ABI view mapped to write_action are red then green", () => {
    assert.throws(
      () => assertKindSafe("useReadContract", "set_passport_uri"),
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        assert.match(err.message, /kind mismatch: read primitive/);
        return true;
      },
    );
    assert.throws(
      () =>
        assertKindSafe("writeContractAsync", "set_passport_uri", {
          abiId: "KarPassportAbi",
          functionName: "custodyLocked",
        }),
      /ABI view mapped to write_action/,
    );
    assertKindSafe("useReadContract", "custody_locked");
    assertKindSafe("writeContractAsync", "set_passport_uri");
  });

  it("(a) allowance without same-file payment write is red then green", () => {
    assert.throws(
      () =>
        assertKindSafe("useReadContract", "fixed_price_buy", {
          abiId: "erc20Abi",
          functionName: "allowance",
          sameFilePaymentWrite: false,
        }),
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        assert.match(err.message, /kind mismatch: read primitive/);
        return true;
      },
    );
    assertKindSafe("useReadContract", "fixed_price_buy", {
      abiId: "erc20Abi",
      functionName: "allowance",
      sameFilePaymentWrite: true,
    });
    assertKindSafe("useReadContract", "ascending_bid", {
      abiId: "erc20Abi",
      functionName: "allowance",
      sameFilePaymentWrite: true,
    });
  });

  it("(a) planted allowance-only file stays unmapped then live bid/buy map is green", () => {
    const plant: Parameters<typeof mapSurfacePairsToCapabilities>[0] = [
      {
        file: "components/planted/allowance-only.tsx",
        primitive: "useReadContract",
        functionName: "allowance",
        abiId: "erc20Abi",
      },
    ];
    const planted = mapSurfacePairsToCapabilities(plant);
    assert.equal(planted.mapped.length, 0);
    assert.equal(planted.unmappedContractCalls.length, 1);
    assert.equal(planted.unmappedContractCalls[0]!.functionName, "allowance");

    const sources = loadLiveSurfaceSources();
    const derived = deriveSurfaceConsumerPairs(sources);
    const { mapped, unmappedContractCalls } = mapSurfacePairsToCapabilities(
      derived,
      sources,
    );
    assert.equal(unmappedContractCalls.length, 0);
    assert.ok(
      mapped.some(
        (p) =>
          p.functionName === "allowance" &&
          (p.capability === "fixed_price_buy" ||
            p.capability === "ascending_bid"),
      ),
      "live map must absorb allowance into payment writes",
    );
  });

  it("(b) read evidence, program bounds, counterparts, and B absence agree", () => {
    const ix = loadIxManifest();
    const state = loadStateManifest();
    const sources = loadLiveSurfaceSources();
    const derived = deriveSurfaceConsumerPairs(sources);
    const { mapped } = mapSurfacePairsToCapabilities(derived, sources);
    const classB = SURFACE_CAPABILITIES.filter(
      (id) => surfaceClassOf(id) === "B",
    );

    assertClassAEvidencePresent(
      SURFACE_CENSUS_CAPABILITY_META,
      ix,
      state,
    );
    assertCapabilityProgramBound(mapped);
    assertWriteCounterpartMatchesCell(mapped, ix);
    assertNotInProgramAbsent(classB, mapped, ix);

    for (const m of SURFACE_CENSUS_CAPABILITY_META) {
      if (surfaceClassOf(m.id) === "B") {
        assert.equal(
          m.evidence,
          null,
          `class-B must not store evidence: ${m.id}`,
        );
      }
    }

    const approval = deriveClassBEvidence(
      "passport_set_approval_for_all",
      mapped,
      ix,
    );
    assert.deepEqual(approval.items, ["SetApprovalForAll"]);
    assert.equal(approval.scopeEnum, "PassportIx");

    const cancel = deriveClassBEvidence("ascending_cancel", mapped, ix);
    assert.deepEqual(cancel.items, ["AgentWithdraw", "OwnerWithdraw"]);
    assert.equal(cancel.scopeEnum, "AscendingIx");
    assert.equal(
      SURFACE_CENSUS_CAPABILITY_META.find(
        (row) => row.id === "ascending_recall_cooldown",
      )?.evidence,
      null,
    );
  });

  it("(b) planted null class-A read evidence is red then green", () => {
    const planted: SurfaceCensusCapabilityMeta[] =
      SURFACE_CENSUS_CAPABILITY_META.map((m) =>
        m.id === "custody_locked" ? { ...m, evidence: null } : m,
      );
    assert.throws(
      () =>
        assertClassAEvidencePresent(
          planted,
          loadIxManifest(),
          loadStateManifest(),
        ),
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        assert.match(err.message, /class-A evidence null for custody_locked/);
        return true;
      },
    );
    assertClassAEvidencePresent(
      SURFACE_CENSUS_CAPABILITY_META,
      loadIxManifest(),
      loadStateManifest(),
    );
  });

  it("(b) planted counterpart/cell contradiction is red then green", () => {
    const sources = loadLiveSurfaceSources();
    const { mapped } = mapSurfacePairsToCapabilities(
      deriveSurfaceConsumerPairs(sources),
      sources,
    );
    const planted: SurfaceSupportTable = {
      ...SURFACE_SUPPORT_TABLE,
      set_passport_uri: {
        evm: { supported: true, family: "evm" },
        svm: { supported: false, cause: "not_in_program" },
      },
    };
    assert.throws(
      () => assertWriteCounterpartMatchesCell(mapped, loadIxManifest(), planted),
      /counterpart presence contradicts cell: set_passport_uri/,
    );
    assertWriteCounterpartMatchesCell(mapped, loadIxManifest());
  });

  it("(b) planted missing ApproveEscrow cross-program end is red then green", () => {
    const sources = loadLiveSurfaceSources();
    const { mapped } = mapSurfacePairsToCapabilities(
      deriveSurfaceConsumerPairs(sources),
      sources,
    );
    const live = loadIxManifest();
    const planted: IxManifestLike = {
      entries: live.entries.filter(
        (entry) =>
          !(
            entry.enum === "AscendingIx" &&
            entry.name === "ApproveEscrow"
          ),
      ),
    };
    assert.throws(
      () => assertWriteCounterpartMatchesCell(mapped, planted),
      /counterpart presence contradicts cell: passport_approve/,
    );
    assertWriteCounterpartMatchesCell(mapped, live);
  });

  it("(b) cross-program correspondence requires SPEC D-id", () => {
    const spec = fs.readFileSync(
      path.join(ROOT, "docs/contracts/SPEC.md"),
      "utf8",
    );
    const cross = SURFACE_CORRESPONDENCE.find(
      (row) => row.svmEnums.length > 1,
    )!;
    assert.throws(
      () =>
        assertCrossProgramCorrespondence(spec, [
          { ...cross, divergenceId: undefined },
        ]),
      /cross-program correspondence missing D-id/,
    );
    assertCrossProgramCorrespondence(spec);
  });

  it("(b) correspondence ends must both be extracted", () => {
    const ix = loadIxManifest();
    const abiFnExists = (abiId: string, fn: string) =>
      Object.hasOwn(ABI_FN_TO_CAPABILITY[abiId] ?? {}, fn);
    const ixVariantExists = (enumName: string, variant: string) =>
      ix.entries.some(
        (entry) => entry.enum === enumName && entry.name === variant,
      );
    assert.throws(
      () =>
        assertCorrespondenceEndsExtracted(
          (abiId, fn) =>
            !(abiId === "KarPassportAbi" && fn === "setPassportURI") &&
            abiFnExists(abiId, fn),
          ixVariantExists,
        ),
      /correspondence missing EVM end/,
    );
    assert.throws(
      () =>
        assertCorrespondenceEndsExtracted(
          abiFnExists,
          (enumName, variant) =>
            !(enumName === "PassportIx" && variant === "SetPassportUri") &&
            ixVariantExists(enumName, variant),
        ),
      /correspondence missing SVM end/,
    );
    assertCorrespondenceEndsExtracted(abiFnExists, ixVariantExists);
  });

  it("(b) planted renamed class-A field is red then green", () => {
    const stateRaw = fs.readFileSync(STATE_MANIFEST, "utf8");
    const planted = stateRaw.replace(/custody_locked/g, "custody_locked_RENAMED");
    const state = loadStateManifest(planted);
    const meta = SURFACE_CENSUS_CAPABILITY_META.filter(
      (m) => m.id === "custody_locked",
    );
    assert.throws(
      () =>
        assertClassAEvidencePresent(
          meta,
          loadIxManifest(),
          state,
        ),
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        assert.match(
          err.message,
          /class-A evidence missing for custody_locked/,
        );
        return true;
      },
    );
    assertClassAEvidencePresent(
      meta,
      loadIxManifest(),
      loadStateManifest(),
    );
  });

  it("(b) planted non-allowlisted chain evidence item is red then green", () => {
    const planted: SurfaceCensusCapabilityMeta[] =
      SURFACE_CENSUS_CAPABILITY_META.map((m) =>
        m.id === "pay_verification_fee"
          ? {
              ...m,
              evidence: { source: "chain", item: "invented_transfer" },
            }
          : m,
      );
    assert.throws(
      () =>
        assertClassAEvidencePresent(
          planted,
          loadIxManifest(),
          loadStateManifest(),
        ),
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        assert.match(
          err.message,
          /chain evidence item not allowlisted: invented_transfer/,
        );
        return true;
      },
    );
    assertClassAEvidencePresent(
      SURFACE_CENSUS_CAPABILITY_META,
      loadIxManifest(),
      loadStateManifest(),
    );
  });

  it("(b) planted in-scope struct field rename is red while word survives elsewhere", () => {
    const programRel = boundProgramRelDir("fixed_price_paused")!;
    const roots = resolveProgramScopeRoots(programRel);
    const liveRust = loadScopedRustText(roots);
    assert.ok(liveRust.includes("paused"));
    const plantedRust = liveRust.replace(
      /pub struct CommerceConfig \{([\s\S]*?)pub paused: bool/,
      "pub struct CommerceConfig {$1pub paused_RENAMED: bool",
    );
    assert.ok(
      plantedRust.includes("paused"),
      "word paused must still appear outside the CommerceConfig field",
    );
    const meta = SURFACE_CENSUS_CAPABILITY_META.filter(
      (m) => m.id === "fixed_price_paused",
    );
    assert.throws(
      () =>
        assertClassAEvidencePresent(meta, loadIxManifest(), loadStateManifest(), {
          scopedRustByCapability: new Map([
            ["fixed_price_paused", plantedRust],
          ]),
        }),
      /class-A evidence missing for fixed_price_paused/,
    );
    assertClassAEvidencePresent(meta, loadIxManifest(), loadStateManifest());
  });

  it("(b) planted cfg(test)-only struct field is red then green", () => {
    const plantedRust = `
#[cfg(test)]
mod tests {
  pub struct CommerceConfig {
    pub paused: bool,
  }
}
pub struct CommerceConfig {
  pub authority: [u8; 32],
}
`;
    const meta = SURFACE_CENSUS_CAPABILITY_META.filter(
      (m) => m.id === "fixed_price_paused",
    );
    assert.throws(
      () =>
        assertClassAEvidencePresent(meta, loadIxManifest(), loadStateManifest(), {
          scopedRustByCapability: new Map([
            ["fixed_price_paused", plantedRust],
          ]),
        }),
      /class-A evidence missing for fixed_price_paused/,
    );
    assertClassAEvidencePresent(meta, loadIxManifest(), loadStateManifest());
  });

  it("(b) planted const only in a comment is red then green", () => {
    const plantedRust = `
// pub const RECALL_COOLDOWN_SECS: u64 = 1;
pub struct CommerceConfig {
  pub paused: bool,
}
`;
    const meta = SURFACE_CENSUS_CAPABILITY_META.filter(
      (m) => m.id === "fixed_price_recall_cooldown",
    );
    assert.throws(
      () =>
        assertClassAEvidencePresent(meta, loadIxManifest(), loadStateManifest(), {
          scopedRustByCapability: new Map([
            ["fixed_price_recall_cooldown", plantedRust],
          ]),
        }),
      /class-A evidence missing for fixed_price_recall_cooldown/,
    );
    assertClassAEvidencePresent(meta, loadIxManifest(), loadStateManifest());
  });

  it("(b) planted foreign_field program not in manifest is red then green", () => {
    const meta = SURFACE_CENSUS_CAPABILITY_META.filter(
      (m) => m.id === "passport_owner",
    );
    assert.throws(
      () =>
        assertClassAEvidencePresent(meta, loadIxManifest(), loadStateManifest(), {
          foreignProgramIds: new Set(["system"]),
        }),
      /class-A evidence missing for passport_owner/,
    );
    assertClassAEvidencePresent(meta, loadIxManifest(), loadStateManifest());
  });

  it("(b) planted foreign_field type only in a comment is red then green", () => {
    const plantedRust = `
// use mpl_core::accounts::BaseAssetV1;
pub fn read_owner() {
  let x = base.owner;
}
`;
    const meta = SURFACE_CENSUS_CAPABILITY_META.filter(
      (m) => m.id === "passport_owner",
    );
    assert.throws(
      () =>
        assertClassAEvidencePresent(meta, loadIxManifest(), loadStateManifest(), {
          scopedRustByCapability: new Map([["passport_owner", plantedRust]]),
        }),
      /class-A evidence missing for passport_owner/,
    );
    assertClassAEvidencePresent(meta, loadIxManifest(), loadStateManifest());
  });

  it("(b) planted read citing ix name is red then green", () => {
    const planted: SurfaceCensusCapabilityMeta[] =
      SURFACE_CENSUS_CAPABILITY_META.map((m) =>
        m.id === "fixed_price_paused"
          ? {
              ...m,
              evidence: { source: "ix", item: "ApprovePaymentToken" },
            }
          : m,
      );
    assert.throws(
      () =>
        assertClassAEvidencePresent(
          planted,
          loadIxManifest(),
          loadStateManifest(),
        ),
      /class-A read must not cite ix name: fixed_price_paused/,
    );
    assertClassAEvidencePresent(
      SURFACE_CENSUS_CAPABILITY_META,
      loadIxManifest(),
      loadStateManifest(),
    );
  });

  it("(c) planted OwnerWithdraw into AscendingIx is red then green", () => {
    const sources = loadLiveSurfaceSources();
    const derived = deriveSurfaceConsumerPairs(sources);
    const { mapped } = mapSurfacePairsToCapabilities(derived, sources);
    const classB = SURFACE_CAPABILITIES.filter(
      (id) => surfaceClassOf(id) === "B",
    );
    const live = loadIxManifest();
    assertNotInProgramAbsent(classB, mapped, live);

    const plantedIx: IxManifestLike = {
      entries: [
        ...live.entries,
        { name: "OwnerWithdraw", enum: "AscendingIx" },
      ],
    };
    assert.throws(
      () => assertNotInProgramAbsent(classB, mapped, plantedIx),
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        assert.match(
          err.message,
          /not_in_program item unexpectedly present: OwnerWithdraw in AscendingIx/,
        );
        return true;
      },
    );
    assertNotInProgramAbsent(classB, mapped, live);
  });

  it("(c) class-B ABI with no enum match is red then green", () => {
    const sources = loadLiveSurfaceSources();
    const derived = deriveSurfaceConsumerPairs(sources);
    const { mapped } = mapSurfacePairsToCapabilities(derived, sources);
    const live = loadIxManifest();
    const plantedPairs = mapped.map((p) =>
      p.capability === "ascending_cancel" && p.functionName != null
        ? { ...p, abiId: "TotallyUnknownAbi" }
        : p,
    );
    assert.throws(
      () =>
        deriveClassBEvidence("ascending_cancel", plantedPairs, live),
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        assert.match(err.message, /class-B ABI maps to no ix enum/);
        return true;
      },
    );
    const ok = deriveClassBEvidence("ascending_cancel", mapped, live);
    assert.equal(ok.scopeEnum, "AscendingIx");
  });

  it("SVM cell family evm outside class-C set is red then green", () => {
    const planted: SurfaceSupportTable = {
      ...SURFACE_SUPPORT_TABLE,
      set_passport_uri: {
        evm: { supported: true, family: "evm" },
        svm: { supported: true, family: "evm" },
      },
    };
    assert.throws(
      () =>
        assertSvmEvmFamilyOnlyClassC(
          planted,
          SURFACE_CLASS_C_CAPABILITIES as readonly string[],
        ),
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        assert.match(err.message, /outside class-C set/);
        return true;
      },
    );
    assertSvmEvmFamilyOnlyClassC(
      SURFACE_SUPPORT_TABLE,
      SURFACE_CLASS_C_CAPABILITIES as readonly string[],
    );
  });

  it("no erc20 allowance capability residue", () => {
    const residue = "erc20" + "_allowance";
    const roots = [
      "lib/web3/surface-support.ts",
      "test/surface-support-map.ts",
      "test/surface-support-assert.ts",
      "test/surface-support-derive.ts",
      "test/fixtures/surface-support-census.ts",
    ];
    for (const rel of roots) {
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      assert.equal(
        text.includes(residue),
        false,
        `${residue} residue in ${rel}`,
      );
    }
  });

  it("no has_live_consignment capability residue", () => {
    const residue = "has_live" + "_consignment";
    const roots = [
      "lib/web3/surface-support.ts",
      "test/surface-support-map.ts",
      "test/surface-support-assert.ts",
      "test/surface-support-derive.ts",
      "test/fixtures/surface-support-census.ts",
    ];
    for (const rel of roots) {
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      assert.equal(
        text.includes(residue),
        false,
        `${residue} residue in ${rel}`,
      );
    }
  });

  it("(d) behaviour matrix: ForCapability ≡ txWriteAvailability for migrated owners", () => {
    const sources = loadLiveSurfaceSources();
    const owners = deriveMigratedTxWriteOwners(sources);
    assert.ok(
      owners.length >= SURFACE_SUPPORT_FLOORS.migratedTxWriteOwners,
      `owner floor: ${owners.length}`,
    );

    const namespaces = [
      ...Object.keys(COMMERCIAL_ACTIVE).map(Number),
      999_999_999,
    ];
    const sessions: ActiveAccount[] = [
      disconnectedAccount(),
      evmSession(),
      svmSession(),
    ];

    let comparisons = 0;
    for (const file of owners) {
      const text = sources.get(file);
      assert.ok(text, file);
      const capability = capabilityFromMigratedOwnerSource(file, text);
      assert.ok(capability, `missing capability literal: ${file}`);
      for (const account of sessions) {
        for (const ns of namespaces) {
          const next = txWriteAvailabilityForCapability(
            account,
            capability!,
            ns,
          );
          const prev = txWriteAvailability(account, ns);
          assertMatrixEqual(
            next,
            prev,
            `${file} cap=${capability} ns=${ns} account=${account.status}/${"vm" in account ? account.vm : "-"}`,
          );
          comparisons += 1;
        }
      }
    }

    const expected =
      owners.length * sessions.length * namespaces.length;
    assert.equal(expected, 144, "matrix must remain 12 × 3 × 4");
    assert.equal(
      comparisons,
      expected,
      `comparison count: owners=${owners.length} × sessions=${sessions.length} × namespaces=${namespaces.length} = ${expected}`,
    );
  });

  it("(d) planted unsupported capability makes matrix red then green", () => {
    const plantedTable: SurfaceSupportTable = {
      ...SURFACE_SUPPORT_TABLE,
      set_passport_uri: {
        evm: { supported: false, cause: "product_owner_owed" },
        svm: { supported: false, cause: "product_owner_owed" },
      },
    };
    const account = evmSession();
    const ns = 84532;
    const next = txWriteAvailabilityForCapability(
      account,
      "set_passport_uri",
      ns,
      undefined,
      plantedTable,
    );
    const prev = txWriteAvailability(account, ns);
    assert.throws(
      () =>
        assertMatrixEqual(
          next,
          prev,
          "planted ForCapability diverge",
        ),
      (err: unknown) => {
        assert.ok(err instanceof assert.AssertionError);
        return true;
      },
    );
    assertMatrixEqual(
      txWriteAvailabilityForCapability(account, "set_passport_uri", ns),
      txWriteAvailability(account, ns),
      "live matrix",
    );
  });

  it("meta covers every SURFACE_CAPABILITIES id exactly once", () => {
    const ids = SURFACE_CENSUS_CAPABILITY_META.map((m) => m.id);
    assert.deepEqual([...ids].sort(), [...SURFACE_CAPABILITIES].sort());
    for (const m of SURFACE_CENSUS_CAPABILITY_META) {
      assert.equal(m.kind, SURFACE_CAPABILITY_KIND[m.id]);
    }
  });

  it("no fileDefaultCapabilities / path-regex map residue", () => {
    const mapSrc = fs.readFileSync(
      path.join(ROOT, "test/surface-support-map.ts"),
      "utf8",
    );
    assert.equal(/fileDefaultCapabilities/.test(mapSrc), false);
    assert.equal(/\/auction\|ascending/.test(mapSrc), false);
  });

  it("fragment ABI keys cannot enter the concrete map", () => {
    assert.throws(
      () =>
        assertNoFragmentKeysInMap({
          ...ABI_FN_TO_CAPABILITY,
          commerceModeAbi: {},
        }),
      /fragment ABI key forbidden/,
    );
    assertNoFragmentKeysInMap();
  });
});

/** Exact chrome sentences owned solely by surfaceSupportCauseCopy. */
const SUPPORT_CAUSE_SENTENCES = SURFACE_SUPPORT_CAUSES.map((c) =>
  surfaceSupportCauseCopy(c),
);

/**
 * Product file that embeds a support-cause sentence literal outside the owner.
 * Exported so the plant can call the same helper as the live scan.
 */
export function findSupportCauseSentenceLiteralHits(
  rel: string,
  source: string,
): string | false {
  for (const sentence of SUPPORT_CAUSE_SENTENCES) {
    if (source.includes(JSON.stringify(sentence))) {
      return `re-inlined SurfaceSupportCause sentence (sole owner: lib/web3/surface-support.ts surfaceSupportCauseCopy): ${sentence}`;
    }
  }
  return false;
}

describe("surfaceSupportCauseCopy sole owner", () => {
  it("exhaustive subject-neutral sentences for every SurfaceSupportCause", () => {
    assert.deepEqual([...SURFACE_SUPPORT_CAUSES].sort(), [
      "authority_only",
      "not_in_program",
      "product_owner_owed",
    ]);
    assert.equal(
      surfaceSupportCauseCopy("not_in_program"),
      "This network's passport program does not provide this.",
    );
    assert.equal(
      surfaceSupportCauseCopy("authority_only"),
      "Only the program authority can do this on this network.",
    );
    assert.equal(
      surfaceSupportCauseCopy("product_owner_owed"),
      "This app does not read this on this network yet.",
    );
    for (const cause of SURFACE_SUPPORT_CAUSES) {
      assert.ok(surfaceSupportCauseCopy(cause).length > 0, cause);
    }
  });

  it("product tree never re-inlines support-cause sentences (planted copy red then green)", () => {
    const owners = ["lib/web3/surface-support.ts"];
    const planted = `export const bad = ${JSON.stringify(SUPPORT_CAUSE_SENTENCES[0])};\n`;
    assert.equal(
      findSupportCauseSentenceLiteralHits(
        "lib/passport/commerce-fact.ts",
        planted,
      ) !== false,
      true,
      "planted re-inline must be detected",
    );
    assert.throws(
      () =>
        assertCleanProductScan(
          {
            filesRead: 1,
            violations: [
              {
                path: "lib/passport/commerce-fact.ts",
                reason: findSupportCauseSentenceLiteralHits(
                  "lib/passport/commerce-fact.ts",
                  planted,
                ) as string,
              },
            ],
            unreadable: [],
          },
          { owners, allowEmptyTargets: true },
        ),
      /re-inlined SurfaceSupportCause sentence/,
    );

    const scan = scanProductSources(findSupportCauseSentenceLiteralHits, {
      owners,
    });
    assertCleanProductScan(scan, { owners });
  });
});
