/**
 * Commercial SVM PDA derivation — TS owner vs committed Rust goldens.
 *
 * Goldens are authored solely by Rust `find_program_address` (`kargain-ix-wire`).
 * This suite never repairs or regenerates them.
 *
 * Doors: product entry = registry only; layout seam = synthetic only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  deriveSvmPda,
  deriveSvmPdaLayout,
  pdaManifestRecipes,
  pdaSyntheticProgramId,
  pdaSyntheticProgramIdHex,
  sampleSeedsFromManifest,
  type DeriveSvmPdaCause,
  type PdaManifest,
  type PdaManifestRecipe,
} from "@/lib/svm/derive-pda";
import {
  commercialSvmNamespaceIds,
  requireSvmCommercialActive,
} from "@/lib/web3/commercial-active";
import {
  assertCleanProductScan,
  scanProductSources,
  type ProductSourcePredicate,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_REL = "svm/crates/kargain-ix-wire/pda.manifest.json";
const OWNER_REL = "lib/svm/derive-pda.ts";

const RECIPES = pdaManifestRecipes();
const SYNTHETIC = pdaSyntheticProgramId();

const LIVE_SVM_PROGRAM_IDS = (() => {
  const ids: string[] = [];
  for (const namespace of commercialSvmNamespaceIds()) {
    const stack = requireSvmCommercialActive(namespace);
    for (const field of [
      "karPassport",
      "karProPass",
      "karProStaking",
      "bridgeGateway",
      "fixedPriceConsignment",
      "ascendingConsignment",
    ] as const) {
      const v = stack[field];
      if (typeof v === "string" && v.length > 0) ids.push(v);
    }
  }
  return ids;
})();

function loadWorkingManifest(): PdaManifest {
  return JSON.parse(
    readFileSync(path.join(ROOT, MANIFEST_REL), "utf8"),
  ) as PdaManifest;
}

function assertMatchesGolden(
  recipe: PdaManifestRecipe,
  derived: { address: string; bump: number },
): void {
  if (
    derived.address !== recipe.goldenAddress ||
    derived.bump !== recipe.goldenBump
  ) {
    throw new Error(
      `golden_mismatch:${recipe.id}:got_${derived.address}/${derived.bump}_want_${recipe.goldenAddress}/${recipe.goldenBump}`,
    );
  }
}

/**
 * Product-graph ban: web3.js sync PDA / package / ad-hoc seed literals /
 * product import of the golden-verification seam.
 */
export function productPdaBypassPredicate(
  relPath: string,
  source: string,
): string | false {
  if (relPath === OWNER_REL) return false;
  if (
    /\bfindProgramAddressSync\b/.test(source) ||
    /\bfrom\s+["']@solana\/web3\.js["']/.test(source) ||
    /\brequire\s*\(\s*["']@solana\/web3\.js["']\s*\)/.test(source)
  ) {
    return `product_pda_or_web3js (${relPath})`;
  }
  if (/\bfrom\s+["']@solana\/addresses["']/.test(source)) {
    return `direct_solana_addresses_import (${relPath})`;
  }
  // Ad-hoc seed tag literals outside the owner (ASCII seed words used by recipes).
  if (
    /Buffer\.from\(\s*["'](?:config|asset|state|record|freeze|Peer|stake|pass|claim|escrow|challenge|custody|consignment|mandate|recall|passport-bind)["']\s*\)/.test(
      source,
    ) ||
    /new\s+TextEncoder\(\)\s*\.encode\(\s*["'](?:config|asset|state|record|freeze|Peer|stake|pass|claim|escrow|challenge|custody|passport-bind)["']\s*\)/.test(
      source,
    )
  ) {
    return `ad_hoc_pda_seed_literal (${relPath})`;
  }
  if (
    /\bexport\s+(?:async\s+)?function\s+deriveSvmPda\b/.test(source) ||
    /\bexport\s+const\s+deriveSvmPda\b/.test(source)
  ) {
    return `second_pda_owner (${relPath})`;
  }
  // Layout seam is golden/plant only — product files must not import it.
  if (
    /\bderiveSvmPdaLayout\b/.test(source) &&
    (/\bimport\s*\{[^}]*\bderiveSvmPdaLayout\b/.test(source) ||
      /\bimport\s+\*\s+as\s+\w+\s+from\s+["'][^"']*derive-pda["']/.test(source))
  ) {
    return `product_imports_pda_layout_seam (${relPath})`;
  }
  return false;
}

describe("svm pda derivation policy", () => {
  it("pda census recipe count equals the acknowledged floor (31)", () => {
    assert.equal(RECIPES.length, 31);
    const working = loadWorkingManifest();
    assert.equal(working.recipes.length, 31);
    assert.ok(
      working.recipes.some((r) => r.id === "kargain-consignment-base/passport_binding"),
      "passport_binding recipe required",
    );
  });

  it("synthetic program id is the documented 0x11×32 constant", () => {
    assert.equal(pdaSyntheticProgramIdHex(), "11".repeat(32));
    assert.ok(typeof SYNTHETIC === "string" && SYNTHETIC.length >= 32);
  });

  it("no live commercial program id appears in the committed PDA manifest", () => {
    const text = readFileSync(path.join(ROOT, MANIFEST_REL), "utf8");
    for (const id of LIVE_SVM_PROGRAM_IDS) {
      assert.equal(
        text.includes(id),
        false,
        `live_program_id_in_pda_manifest:${id}`,
      );
    }
  });

  // Bidirectional coverage from two independently built structures — not one
  // array walked twice. recipeIds comes from recipe.id; goldenIds comes from
  // entries that carry both goldenAddress and goldenBump.
  it("every recipe has a golden and every golden has a recipe (bidirectional)", () => {
    const working = loadWorkingManifest();
    const recipeIds = new Set(working.recipes.map((r) => r.id));
    const goldenById = new Map<string, { address: string; bump: number }>();
    for (const r of working.recipes) {
      assert.ok(
        typeof r.goldenAddress === "string" && r.goldenAddress.length > 0,
        `missing_golden_address:${r.id}`,
      );
      assert.ok(
        Number.isInteger(r.goldenBump) &&
          r.goldenBump >= 0 &&
          r.goldenBump <= 255,
        `missing_golden_bump:${r.id}`,
      );
      goldenById.set(r.id, {
        address: r.goldenAddress,
        bump: r.goldenBump,
      });
    }
    const goldenIds = new Set(goldenById.keys());
    assert.equal(recipeIds.size, working.recipes.length);
    assert.equal(goldenIds.size, working.recipes.length);
    for (const id of recipeIds) {
      assert.ok(goldenIds.has(id), `recipe_without_golden:${id}`);
    }
    for (const id of goldenIds) {
      assert.ok(recipeIds.has(id), `golden_without_recipe:${id}`);
    }
  });

  it("layout seam reproduces every committed golden address and bump", async () => {
    let comparisons = 0;
    for (const recipe of RECIPES) {
      const result = await deriveSvmPdaLayout({
        recipe,
        programId: SYNTHETIC,
        seeds: sampleSeedsFromManifest(recipe),
      });
      assert.equal(
        result.ok,
        true,
        `derive_failed:${recipe.id}:${result.ok === false ? result.detail : ""}`,
      );
      if (!result.ok) continue;
      assertMatchesGolden(recipe, {
        address: result.address,
        bump: result.bump,
      });
      comparisons += 1;
      for (const alt of recipe.alternateSamples ?? []) {
        const altResult = await deriveSvmPdaLayout({
          recipe,
          programId: SYNTHETIC,
          seeds: sampleSeedsFromManifest(recipe, alt.sample),
        });
        assert.equal(
          altResult.ok,
          true,
          `derive_failed_alt:${recipe.id}:${altResult.ok === false ? altResult.detail : ""}`,
        );
        if (!altResult.ok) continue;
        if (
          altResult.address !== alt.goldenAddress ||
          altResult.bump !== alt.goldenBump
        ) {
          throw new Error(
            `golden_mismatch:${recipe.id}:alt:got_${altResult.address}/${altResult.bump}_want_${alt.goldenAddress}/${alt.goldenBump}`,
          );
        }
        comparisons += 1;
      }
    }
    assert.ok(comparisons >= RECIPES.length);
    console.log(
      `svm-pda-derivation: ${comparisons} derivations compared over ${RECIPES.length} recipes`,
    );
  });

  it("claim and claim_ata share dynamics but derive different addresses", async () => {
    const claim = RECIPES.find((r) => r.id === "kargain-claimable-payouts/claim");
    const claimAta = RECIPES.find(
      (r) => r.id === "kargain-claimable-payouts/claim_ata",
    );
    assert.ok(claim && claimAta);
    assert.deepEqual(claim!.sample, claimAta!.sample);
    assert.notEqual(claim!.seedTagHex, claimAta!.seedTagHex);
    const a = await deriveSvmPdaLayout({
      recipe: claim!,
      programId: SYNTHETIC,
      seeds: sampleSeedsFromManifest(claim!),
    });
    const b = await deriveSvmPdaLayout({
      recipe: claimAta!,
      programId: SYNTHETIC,
      seeds: sampleSeedsFromManifest(claimAta!),
    });
    assert.equal(a.ok && b.ok, true);
    if (a.ok && b.ok) {
      assert.notEqual(a.address, b.address);
    }
  });

  it("registered commercial program id is accepted; foreign id refuses unregistered_program", async () => {
    const passport = LIVE_SVM_PROGRAM_IDS[0];
    assert.ok(passport);
    const ok = await deriveSvmPda({
      recipe: "kar-passport/config",
      programId: passport!,
    });
    assert.equal(ok.ok, true, ok.ok === false ? ok.detail : "");

    const bad = await deriveSvmPda({
      recipe: "kar-passport/config",
      programId: "11111111111111111111111111111111",
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.cause, "unregistered_program");
    }
  });

  it("product entry refuses the synthetic program id as unregistered_program", async () => {
    // Planted change: deriveSvmPda({…, programId: SYNTHETIC}).
    const result = await deriveSvmPda({
      recipe: "kar-passport/config",
      programId: SYNTHETIC,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.cause, "unregistered_program");
    }
  });

  it("layout seam refuses a live registry program id as not_synthetic_program", async () => {
    const passport = LIVE_SVM_PROGRAM_IDS[0]!;
    // Planted change: deriveSvmPdaLayout({…, programId: liveRegistryId}).
    const result = await deriveSvmPdaLayout({
      recipe: RECIPES.find((r) => r.id === "kar-passport/config")!,
      programId: passport,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.cause, "not_synthetic_program");
    }
  });

  it("all five refusal causes are reachable by name", async () => {
    const passport = LIVE_SVM_PROGRAM_IDS[0]!;
    const causes = new Set<DeriveSvmPdaCause>();

    const unknown = await deriveSvmPda({
      recipe: "no-such/recipe",
      programId: passport,
    });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) causes.add(unknown.cause);

    const missing = await deriveSvmPda({
      recipe: "kar-passport/asset",
      programId: passport,
      seeds: {},
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) causes.add(missing.cause);

    const invalid = await deriveSvmPda({
      recipe: "kar-passport/asset",
      programId: passport,
      seeds: { token_id: "aa" },
    });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) causes.add(invalid.cause);

    const unreg = await deriveSvmPda({
      recipe: "kar-passport/config",
      programId: SYNTHETIC,
    });
    assert.equal(unreg.ok, false);
    if (!unreg.ok) causes.add(unreg.cause);

    const notSynth = await deriveSvmPdaLayout({
      recipe: RECIPES.find((r) => r.id === "kar-passport/config")!,
      programId: passport,
    });
    assert.equal(notSynth.ok, false);
    if (!notSynth.ok) causes.add(notSynth.cause);

    assert.deepEqual(
      [...causes].sort(),
      [
        "invalid_seed",
        "missing_seed",
        "not_synthetic_program",
        "unknown_recipe",
        "unregistered_program",
      ],
    );
  });

  it("planted seed-tag flip refuses golden comparison by name", async () => {
    const recipe = structuredClone(
      RECIPES.find((r) => r.id === "kar-passport/config")!,
    );
    // Planted change: flip one byte of seed tag `config` (0x63 → 0x62).
    assert.equal(recipe.seedTagHex, "636f6e666967");
    recipe.seedTagHex = "626f6e666967";
    const derived = await deriveSvmPdaLayout({
      recipe,
      programId: SYNTHETIC,
    });
    assert.equal(derived.ok, true);
    if (!derived.ok) return;
    const original = RECIPES.find((r) => r.id === "kar-passport/config")!;
    assert.throws(
      () =>
        assertMatchesGolden(original, {
          address: derived.address,
          bump: derived.bump,
        }),
      /golden_mismatch:kar-passport\/config/,
    );
  });

  it("planted dynamic-slot swap refuses golden comparison by name", async () => {
    const original = RECIPES.find((r) => r.id === "kar-passport/record")!;
    const recipe = structuredClone(original);
    // Planted change: swap token_id and index dynamic slots.
    assert.equal(recipe.dynamics.length, 2);
    recipe.dynamics = [recipe.dynamics[1]!, recipe.dynamics[0]!];
    const seeds = sampleSeedsFromManifest(original);
    const derived = await deriveSvmPdaLayout({
      recipe,
      programId: SYNTHETIC,
      seeds,
    });
    assert.equal(derived.ok, true);
    if (!derived.ok) return;
    assert.throws(
      () =>
        assertMatchesGolden(original, {
          address: derived.address,
          bump: derived.bump,
        }),
      /golden_mismatch:kar-passport\/record/,
    );
  });

  it("product graph bans findProgramAddressSync, web3.js, ad-hoc seeds, and layout-seam imports outside the owner", () => {
    const scan = scanProductSources(
      productPdaBypassPredicate as ProductSourcePredicate,
    );
    assertCleanProductScan(scan);
  });

  it("both live mode program ids derive passport_binding to different addresses", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length >= 1);
    const stack = requireSvmCommercialActive(namespaces[0]!);
    const fp = stack.fixedPriceConsignment;
    const asc = stack.ascendingConsignment;
    assert.ok(typeof fp === "string" && fp.length > 0);
    assert.ok(typeof asc === "string" && asc.length > 0);
    const a = await deriveSvmPda({
      recipe: "kargain-consignment-base/passport_binding",
      programId: fp,
    });
    const b = await deriveSvmPda({
      recipe: "kargain-consignment-base/passport_binding",
      programId: asc,
    });
    assert.equal(a.ok, true, a.ok === false ? a.detail : "");
    assert.equal(b.ok, true, b.ok === false ? b.detail : "");
    if (a.ok && b.ok) {
      assert.notEqual(a.address, b.address);
    }
  });

  it("planted passport-bind seed-tag flip refuses golden comparison by name", async () => {
    const original = RECIPES.find(
      (r) => r.id === "kargain-consignment-base/passport_binding",
    )!;
    const recipe = structuredClone(original);
    // passport-bind = 70617373706f72742d62696e64; flip first byte.
    assert.equal(recipe.seedTagHex, "70617373706f72742d62696e64");
    recipe.seedTagHex = "71617373706f72742d62696e64";
    const derived = await deriveSvmPdaLayout({
      recipe,
      programId: SYNTHETIC,
    });
    assert.equal(derived.ok, true);
    if (!derived.ok) return;
    assert.throws(
      () =>
        assertMatchesGolden(original, {
          address: derived.address,
          bump: derived.bump,
        }),
      /golden_mismatch:kargain-consignment-base\/passport_binding/,
    );
  });

  it("answer recipe samples both intents; plants miss the LeaveChain golden", async () => {
    const original = RECIPES.find((r) => r.id === "kargain-encumbrance/answer")!;
    assert.equal(original.seedTagHex, "");
    assert.deepEqual(
      original.dynamics.map((d) => d.name),
      ["seed_prefix", "token_id", "intent"],
    );
    assert.equal(original.sample.intent, 0);
    const alts = original.alternateSamples ?? [];
    assert.equal(alts.length, 1);
    assert.equal(alts[0]!.sample.intent, 1);

    const leave = await deriveSvmPdaLayout({
      recipe: original,
      programId: SYNTHETIC,
      seeds: sampleSeedsFromManifest(original),
    });
    assert.equal(leave.ok, true);
    if (leave.ok) {
      assertMatchesGolden(original, {
        address: leave.address,
        bump: leave.bump,
      });
    }

    const open = await deriveSvmPdaLayout({
      recipe: original,
      programId: SYNTHETIC,
      seeds: sampleSeedsFromManifest(original, alts[0]!.sample),
    });
    assert.equal(open.ok, true);
    if (open.ok) {
      assert.notEqual(open.address, original.goldenAddress);
      assert.throws(
        () =>
          assertMatchesGolden(original, {
            address: open.address,
            bump: open.bump,
          }),
        /golden_mismatch:kargain-encumbrance\/answer/,
      );
    }

    const swapped = structuredClone(original);
    swapped.dynamics = [swapped.dynamics[0]!, swapped.dynamics[2]!, swapped.dynamics[1]!];
    const swappedDerived = await deriveSvmPdaLayout({
      recipe: swapped,
      programId: SYNTHETIC,
      seeds: sampleSeedsFromManifest(original),
    });
    assert.equal(swappedDerived.ok, true);
    if (swappedDerived.ok) {
      assert.throws(
        () =>
          assertMatchesGolden(original, {
            address: swappedDerived.address,
            bump: swappedDerived.bump,
          }),
        /golden_mismatch:kargain-encumbrance\/answer/,
      );
    }

    const wrongPrefix = structuredClone(original);
    const prefixPlant = sampleSeedsFromManifest(original);
    prefixPlant.seed_prefix = "fp";
    const prefixDerived = await deriveSvmPdaLayout({
      recipe: wrongPrefix,
      programId: SYNTHETIC,
      seeds: prefixPlant,
    });
    assert.equal(prefixDerived.ok, true);
    if (prefixDerived.ok) {
      assert.throws(
        () =>
          assertMatchesGolden(original, {
            address: prefixDerived.address,
            bump: prefixDerived.bump,
          }),
        /golden_mismatch:kargain-encumbrance\/answer/,
      );
    }
  });

  it("bytes seed_prefix empty and oversized refuse invalid_seed", async () => {
    const namespaces = commercialSvmNamespaceIds();
    const stack = requireSvmCommercialActive(namespaces[0]!);
    const fp = stack.fixedPriceConsignment;
    assert.ok(typeof fp === "string" && fp.length > 0);
    const token =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const empty = await deriveSvmPda({
      recipe: "kargain-encumbrance/answer",
      programId: fp,
      seeds: { seed_prefix: "", token_id: token, intent: 0 },
    });
    assert.equal(empty.ok, false);
    if (!empty.ok) {
      assert.equal(empty.cause, "invalid_seed");
      assert.match(empty.detail, /bytes_empty|bytes_len_/);
    }
    const oversized = await deriveSvmPda({
      recipe: "kargain-encumbrance/answer",
      programId: fp,
      seeds: {
        seed_prefix: new Uint8Array(33),
        token_id: token,
        intent: 0,
      },
    });
    assert.equal(oversized.ok, false);
    if (!oversized.ok) {
      assert.equal(oversized.cause, "invalid_seed");
      assert.match(oversized.detail, /bytes_len_33/);
    }
  });

  it("planted product bypass and layout-seam import turn red then green", () => {
    const plantedWeb3 = `
      import { PublicKey } from "@solana/web3.js";
      PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
    `;
    assert.ok(
      productPdaBypassPredicate("lib/planted-pda.ts", plantedWeb3),
      "planted web3 bypass must fire",
    );
    assert.equal(
      productPdaBypassPredicate(OWNER_REL, plantedWeb3),
      false,
      "owner path is allowlisted",
    );

    // Planted change: import { deriveSvmPdaLayout } from "@/lib/svm/derive-pda"
    const plantedSeam = `
      import { deriveSvmPdaLayout } from "@/lib/svm/derive-pda";
      void deriveSvmPdaLayout;
    `;
    assert.equal(
      productPdaBypassPredicate("lib/commerce/planted-seam.ts", plantedSeam),
      "product_imports_pda_layout_seam (lib/commerce/planted-seam.ts)",
    );
    assert.equal(
      productPdaBypassPredicate(OWNER_REL, plantedSeam),
      false,
      "owner may reference the seam",
    );
  });
});
