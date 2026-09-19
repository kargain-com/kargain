/**
 * S8-D0 live check functions — each negative plants into these (no assert.ok(false)).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  SURFACE_CAPABILITIES,
  SURFACE_SUPPORT_TABLE,
  isSurfaceChainEvidenceItem,
  isSurfaceChainFactCapability,
  surfaceClassOf,
  type SurfaceCapability,
  type SurfaceSupportTable,
} from "@/lib/web3/surface-support";
import {
  ABI_FN_TO_CAPABILITY,
  CAPABILITY_BOUND_ENUM,
  SURFACE_CAPABILITY_KIND,
  SURFACE_CORRESPONDENCE,
  assertKindSafe as assertKindSafeMapped,
  correspondenceFor,
  type SurfaceCorrespondence,
  type MappedCensusPair,
} from "./surface-support-map.ts";
import type { SurfaceConsumerPair } from "./surface-support-derive.ts";
import type {
  SurfaceCensusCapabilityMeta,
  SurfaceEvidence,
} from "./fixtures/surface-support-census.ts";

const SVM_ROOT = path.join(process.cwd(), "svm");

/** Bound ix enum → program crate directory under svm/. */
export const IX_ENUM_TO_PROGRAM_CRATE: Readonly<Record<string, string>> = {
  PassportIx: "programs/kar-passport",
  FixedPriceIx: "programs/kar-fixed-price",
  AscendingIx: "programs/kar-ascending",
  StakingIx: "programs/kar-pro-staking",
  GatewayIx: "programs/kar-gateway",
};

export type CensusLookup = ReadonlyMap<
  string,
  readonly SurfaceCapability[]
>;

export function buildCensusLookup(
  pairs: readonly {
    file: string;
    primitive: string;
    functionName: string | null;
    capability: SurfaceCapability;
  }[],
): CensusLookup {
  const map = new Map<string, SurfaceCapability[]>();
  for (const p of pairs) {
    const k = `${p.file}::${p.primitive}::${p.functionName ?? ""}`;
    const list = map.get(k) ?? [];
    list.push(p.capability);
    map.set(k, list);
  }
  return map;
}

export function assertDerivedPairsMapped(
  mapped: readonly MappedCensusPair[],
  censusLookup: CensusLookup,
): void {
  for (const pair of mapped) {
    const k = `${pair.file}::${pair.primitive}::${pair.functionName ?? ""}`;
    const caps = censusLookup.get(k);
    assert.ok(
      caps != null && caps.includes(pair.capability),
      `derived pair unmapped to capability: ${k}::${pair.capability}`,
    );
  }
}

export function assertNoMechanismOwnerConsumers(
  derived: readonly SurfaceConsumerPair[],
  ownerFiles: ReadonlySet<string>,
): void {
  for (const pair of derived) {
    assert.equal(
      ownerFiles.has(pair.file),
      false,
      `mechanism owner counted as consumer: ${pair.file}`,
    );
  }
}

export function assertKindSafe(
  primitive: string,
  capability: SurfaceCapability,
  ctx?: {
    abiId?: string | null;
    functionName?: string | null;
    sameFilePaymentWrite?: boolean;
  },
): void {
  assertKindSafeMapped(primitive, capability, ctx);
}

export { assertKindSafeMapped };

export function assertSvmEvmFamilyOnlyClassC(
  table: SurfaceSupportTable,
  classC: readonly string[],
): void {
  for (const id of Object.keys(table) as SurfaceCapability[]) {
    const cell = table[id].svm;
    if (cell.supported && cell.family === "evm") {
      assert.ok(
        classC.includes(id),
        `SVM cell family "evm" outside class-C set: ${id}`,
      );
    }
  }
}

/** Ix manifest entries with enum scope (from ix.manifest.json). */
export type IxManifestLike = {
  entries: ReadonlyArray<{ name: string; enum: string }>;
};

export type StateManifestLike = {
  layouts: ReadonlyArray<{
    id: string;
    fields: ReadonlyArray<{ name: string }>;
  }>;
};

export function extractIxNames(manifest: IxManifestLike): Set<string> {
  return new Set(manifest.entries.map((e) => e.name));
}

export function extractIxNamesInEnum(
  manifest: IxManifestLike,
  enumName: string,
): Set<string> {
  return new Set(
    manifest.entries.filter((e) => e.enum === enumName).map((e) => e.name),
  );
}

export function listIxEnums(manifest: IxManifestLike): string[] {
  return [...new Set(manifest.entries.map((e) => e.enum))].sort();
}

/** PascalCase of an EVM camelCase / PascalCase functionName. */
export function toPascalCaseFunctionName(fn: string): string {
  if (fn.length === 0) return fn;
  return fn[0]!.toUpperCase() + fn.slice(1);
}

/**
 * Map ABI identifier → ix enum by longest stem match against manifest enums
 * (strip trailing `Ix`). No hand-listed table.
 */
export function abiIdToIxEnum(
  abiId: string | null,
  enums: readonly string[],
): string | null {
  if (abiId == null || abiId.length === 0) return null;
  const ranked = enums
    .map((en) => ({
      enum: en,
      stem: en.endsWith("Ix") ? en.slice(0, -2) : en,
    }))
    .filter((x) => x.stem.length > 0)
    .sort((a, b) => b.stem.length - a.stem.length);
  for (const { enum: en, stem } of ranked) {
    if (abiId.includes(stem)) return en;
  }
  return null;
}

export type DerivedClassBEvidence = {
  items: string[];
  scopeEnum: string;
  abiId: string;
};

const SURFACE_SUPPORT_SESSION_LIKE = new Set([
  "requireEvmSession",
  "requireEvmSigningBinding",
  "txWriteAvailability",
  "useWalletClient",
  "usePublicClient",
  "runTx(",
  "awaitReceipt(",
  "useSignMessage",
  "useEvmWriteContract",
]);

/**
 * Sole owner of class-B absence evidence — never stored in the fixture.
 * Items = PascalCase of static EVM functionNames on pairs for the capability.
 * Scope = ABI→enum via manifest stems.
 */
export function deriveClassBEvidence(
  capability: SurfaceCapability,
  mappedPairs: readonly MappedCensusPair[],
  ixManifest: IxManifestLike,
): DerivedClassBEvidence {
  const pairs = mappedPairs.filter(
    (p) =>
      p.capability === capability &&
      p.functionName != null &&
      p.abiId != null &&
      !SURFACE_SUPPORT_SESSION_LIKE.has(p.primitive),
  );
  const items = [
    ...new Set(pairs.map((p) => toPascalCaseFunctionName(p.functionName!))),
  ].sort();
  assert.ok(
    items.length > 0,
    `class-B no derivable item for ${capability}`,
  );
  const abiIds = [...new Set(pairs.map((p) => p.abiId!))];
  assert.equal(
    abiIds.length,
    1,
    `class-B mixed abiIds for ${capability}: ${abiIds.join(",")}`,
  );
  const abiId = abiIds[0]!;
  const scopeEnum = abiIdToIxEnum(abiId, listIxEnums(ixManifest));
  assert.ok(
    scopeEnum != null,
    `class-B ABI maps to no ix enum: ${abiId}`,
  );
  return { items, scopeEnum: scopeEnum!, abiId };
}

function reverseAbiFunctions(
  capability: SurfaceCapability,
  enumName?: string,
): Array<{ abiId: string; fn: string }> {
  const out: Array<{ abiId: string; fn: string }> = [];
  for (const [abiId, functions] of Object.entries(ABI_FN_TO_CAPABILITY)) {
    if (
      enumName != null &&
      abiIdToIxEnum(abiId, [enumName]) !== enumName
    ) {
      continue;
    }
    for (const [fn, mappedCapability] of Object.entries(functions)) {
      if (mappedCapability === capability) out.push({ abiId, fn });
    }
  }
  return out;
}

function correspondenceRowsForCapability(
  capability: SurfaceCapability,
  rows: readonly SurfaceCorrespondence[] = SURFACE_CORRESPONDENCE,
): SurfaceCorrespondence[] {
  return rows.filter(
    (row) => ABI_FN_TO_CAPABILITY[row.abiId]?.[row.evmFunction] === capability,
  );
}

export function assertWriteCounterpartMatchesCell(
  mapped: readonly MappedCensusPair[],
  ixManifest: IxManifestLike,
  table: SurfaceSupportTable = SURFACE_SUPPORT_TABLE,
): void {
  for (const capability of SURFACE_CAPABILITIES) {
    if (SURFACE_CAPABILITY_KIND[capability] !== "write_action") continue;
    if (
      isSurfaceChainFactCapability(capability) ||
      capability === "erc20_approve" ||
      capability === "nostr_identity"
    ) {
      continue;
    }

    let enumNames: readonly string[];
    let variant: string | undefined;
    if (capability === "passport_approve") {
      const cross = correspondenceRowsForCapability(capability).find(
        (row) => row.svmEnums.length > 1,
      );
      assert.ok(cross, `capability not program-bound: ${capability}`);
      enumNames = cross!.svmEnums;
      variant = cross!.svmVariant;
    } else {
      const bound = CAPABILITY_BOUND_ENUM[capability];
      assert.ok(bound, `capability not program-bound: ${capability}`);
      enumNames = [bound!];
      const mappedCorrespondence = mapped
        .filter(
          (pair) =>
            pair.capability === capability &&
            pair.abiId != null &&
            pair.functionName != null,
        )
        .map((pair) => correspondenceFor(pair.abiId!, pair.functionName!))
        .find(
          (row): row is SurfaceCorrespondence =>
            row != null && row.svmEnums.includes(bound!),
        );
      variant =
        mappedCorrespondence?.svmVariant ??
        correspondenceRowsForCapability(capability).find((row) =>
          row.svmEnums.includes(bound!),
        )?.svmVariant ??
        reverseAbiFunctions(capability, bound!)[0]?.fn;
      if (variant && !mappedCorrespondence && !correspondenceRowsForCapability(capability).some(
        (row) => row.svmVariant === variant,
      )) {
        variant = toPascalCaseFunctionName(variant);
      }
    }
    assert.ok(variant, `capability not program-bound: ${capability}`);
    const present = enumNames.every((enumName) =>
      extractIxNamesInEnum(ixManifest, enumName).has(variant!),
    );
    const shouldBePresent = surfaceClassOf(capability, table) === "A";
    assert.equal(
      present,
      shouldBePresent,
      `counterpart presence contradicts cell: ${capability}`,
    );
  }
}

export function assertCrossProgramCorrespondence(
  specText: string,
  rows: readonly SurfaceCorrespondence[] = SURFACE_CORRESPONDENCE,
): void {
  for (const row of rows.filter((candidate) => candidate.svmEnums.length > 1)) {
    assert.ok(row.divergenceId, "cross-program correspondence missing D-id");
    const id = row.divergenceId!;
    assert.ok(
      specText.includes(`| ${id} |`) ||
        (specText.includes("13.14") && specText.includes(id)),
      `cross-program D-id not in SPEC §13.14: ${id}`,
    );
  }
}

export function assertCorrespondenceEndsExtracted(
  abiFnExists: (abiId: string, functionName: string) => boolean,
  ixVariantExists: (enumName: string, variant: string) => boolean,
  rows: readonly SurfaceCorrespondence[] = SURFACE_CORRESPONDENCE,
): void {
  for (const row of rows) {
    assert.ok(
      abiFnExists(row.abiId, row.evmFunction),
      "correspondence missing EVM end",
    );
    for (const enumName of row.svmEnums) {
      assert.ok(
        ixVariantExists(enumName, row.svmVariant),
        "correspondence missing SVM end",
      );
    }
  }
}

export function assertCapabilityProgramBound(
  mapped: readonly MappedCensusPair[],
): void {
  const knownEnums = [...new Set(Object.values(CAPABILITY_BOUND_ENUM))];
  const observed = new Map<SurfaceCapability, Set<string>>();
  for (const pair of mapped) {
    if (
      SURFACE_CAPABILITY_KIND[pair.capability] !== "write_action" ||
      pair.abiId == null ||
      pair.functionName == null ||
      pair.abiId === "erc20Abi" ||
      pair.abiId === "AGGREGATOR_V3_ABI" ||
      isSurfaceChainFactCapability(pair.capability) ||
      pair.capability === "nostr_identity"
    ) {
      continue;
    }
    if (pair.capability === "passport_approve") {
      assert.ok(
        correspondenceRowsForCapability(pair.capability).some(
          (row) => row.svmEnums.length > 1,
        ),
        `capability not program-bound: ${pair.capability}`,
      );
      continue;
    }
    assert.ok(
      CAPABILITY_BOUND_ENUM[pair.capability],
      `capability not program-bound: ${pair.capability}`,
    );
    const bound = CAPABILITY_BOUND_ENUM[pair.capability]!;
    const directCorrespondence = correspondenceFor(
      pair.abiId,
      pair.functionName,
    );
    const pairEnum =
      directCorrespondence?.svmEnums.length === 1
        ? directCorrespondence.svmEnums[0]!
        : abiIdToIxEnum(pair.abiId, knownEnums);
    assert.equal(
      pairEnum,
      bound,
      `capability not program-bound: ${pair.capability}`,
    );
    const enums = observed.get(pair.capability) ?? new Set<string>();
    enums.add(bound);
    observed.set(pair.capability, enums);
  }
  for (const [capability, enums] of observed) {
    assert.equal(
      enums.size,
      1,
      `capability not program-bound: ${capability}`,
    );
  }
}

export function extractStateFields(
  manifest: StateManifestLike,
  layoutId: string,
): Set<string> {
  const layout = manifest.layouts.find(
    (l) =>
      l.id === layoutId ||
      l.id.endsWith("/" + layoutId) ||
      l.id.includes(layoutId),
  );
  return new Set((layout?.fields ?? []).map((f) => f.name));
}

function evidenceItems(ev: SurfaceEvidence): string[] {
  if (ev.source === "foreign_field") {
    const f = ev.item;
    return [`${f.program}::${f.type}.${f.field}`];
  }
  const item = ev.item;
  if (typeof item === "string") return [item];
  return [...item];
}

const FOREIGN_PROGRAMS_MANIFEST = path.join(
  SVM_ROOT,
  "crates/kargain-ix-wire/foreign-programs.manifest.json",
);

let foreignProgramIdsCache: ReadonlySet<string> | null = null;

export function loadForeignProgramIds(
  manifestText?: string,
): ReadonlySet<string> {
  if (manifestText == null && foreignProgramIdsCache != null) {
    return foreignProgramIdsCache;
  }
  const text =
    manifestText ?? fs.readFileSync(FOREIGN_PROGRAMS_MANIFEST, "utf8");
  const parsed = JSON.parse(text) as {
    programs?: ReadonlyArray<{ id?: string }>;
  };
  const ids = new Set(
    (parsed.programs ?? [])
      .map((p) => p.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  if (manifestText == null) foreignProgramIdsCache = ids;
  return ids;
}

/**
 * Ix enums that bound this capability's evidence scope.
 * Cross-program correspondence (multi svmEnums) wins over single CAPABILITY_BOUND_ENUM.
 */
export function capabilityScopeEnums(
  capability: SurfaceCapability,
): string[] {
  const rows = correspondenceRowsForCapability(capability);
  const multi = rows.find((row) => row.svmEnums.length > 1);
  if (multi != null) return [...multi.svmEnums];
  if (rows.length > 0) {
    return [...new Set(rows.flatMap((row) => [...row.svmEnums]))];
  }
  const bound = CAPABILITY_BOUND_ENUM[capability];
  return bound != null ? [bound] : [];
}

/** Union of Cargo.toml scopes for all enums bound to the capability. */
export function resolveCapabilityScopeRoots(
  capability: SurfaceCapability,
): string[] | null {
  const enums = capabilityScopeEnums(capability);
  if (enums.length === 0) return null;
  const roots = new Set<string>();
  for (const en of enums) {
    const rel = IX_ENUM_TO_PROGRAM_CRATE[en];
    if (rel == null) continue;
    for (const root of resolveProgramScopeRoots(rel)) roots.add(root);
  }
  return roots.size > 0 ? [...roots].sort() : null;
}

export function scopedRustImportsType(
  rustText: string,
  typeName: string,
): boolean {
  // use path::Type or use path::{…, Type, …}
  const useLine = new RegExp(
    String.raw`\buse\s+[\w:]+(?:\s*::\s*\{\s*[^}]*\b${typeName}\b|\s*::\s*${typeName})\b`,
  );
  return useLine.test(rustText);
}

export function scopedRustReadsForeignField(
  rustText: string,
  fieldName: string,
): boolean {
  return new RegExp(String.raw`\.\s*${fieldName}\b`).test(rustText);
}

export function foreignFieldEvidencePresent(
  item: { program: string; type: string; field: string },
  rustText: string,
  foreignIds: ReadonlySet<string> = loadForeignProgramIds(),
): boolean {
  if (!foreignIds.has(item.program)) return false;
  if (!scopedRustImportsType(rustText, item.type)) return false;
  if (!scopedRustReadsForeignField(rustText, item.field)) return false;
  return true;
}

let workspaceDepPathsCache: ReadonlyMap<string, string> | null = null;

/** Resolve `workspace = true` crate name → absolute path under svm/. */
export function loadWorkspaceDepPaths(
  cargoTomlText?: string,
): ReadonlyMap<string, string> {
  if (cargoTomlText == null && workspaceDepPathsCache != null) {
    return workspaceDepPathsCache;
  }
  const text =
    cargoTomlText ??
    fs.readFileSync(path.join(SVM_ROOT, "Cargo.toml"), "utf8");
  const map = new Map<string, string>();
  const depsBlock = text.match(
    /\[workspace\.dependencies\]([\s\S]*?)(?=\n\[|\s*$)/,
  );
  if (depsBlock) {
    for (const line of depsBlock[1]!.split("\n")) {
      const m = line.match(
        /^\s*([A-Za-z0-9_-]+)\s*=\s*\{[^}]*path\s*=\s*"([^"]+)"/,
      );
      if (m) {
        map.set(m[1]!, path.resolve(SVM_ROOT, m[2]!));
      }
    }
  }
  if (cargoTomlText == null) workspaceDepPathsCache = map;
  return map;
}

/**
 * Parse a program Cargo.toml for path + workspace kargain/kar-* deps.
 * Returns absolute crate roots (program root first).
 */
export function resolveProgramScopeRoots(
  programRelDir: string,
  workspaceDeps: ReadonlyMap<string, string> = loadWorkspaceDepPaths(),
  cargoTomlOverride?: string,
): string[] {
  const programRoot = path.resolve(SVM_ROOT, programRelDir);
  const cargoPath = path.join(programRoot, "Cargo.toml");
  const text =
    cargoTomlOverride ?? fs.readFileSync(cargoPath, "utf8");
  const roots = new Set<string>([programRoot]);
  const depsBlock = text.match(/\[dependencies\]([\s\S]*?)(?=\n\[|\s*$)/);
  if (!depsBlock) return [...roots];
  for (const line of depsBlock[1]!.split("\n")) {
    const pathDep = line.match(
      /^\s*([A-Za-z0-9_-]+)\s*=\s*\{[^}]*path\s*=\s*"([^"]+)"/,
    );
    if (pathDep) {
      roots.add(path.resolve(programRoot, pathDep[2]!));
      continue;
    }
    const workspaceDep = line.match(
      /^\s*([A-Za-z0-9_-]+)\s*=\s*\{[^}]*workspace\s*=\s*true/,
    );
    if (workspaceDep) {
      const resolved = workspaceDeps.get(workspaceDep[1]!);
      if (resolved) roots.add(resolved);
    }
  }
  return [...roots].sort();
}

export function boundProgramRelDir(
  capability: SurfaceCapability,
): string | null {
  const en = CAPABILITY_BOUND_ENUM[capability];
  if (en == null) return null;
  return IX_ENUM_TO_PROGRAM_CRATE[en] ?? null;
}

/** Strip line/block comments from Rust source. */
export function stripRustComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    if (source[i] === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (source[i] === "/" && source[i + 1] === "*") {
      i += 2;
      while (
        i < source.length &&
        !(source[i] === "*" && source[i + 1] === "/")
      ) {
        i++;
      }
      i += 2;
      continue;
    }
    out += source[i];
    i++;
  }
  return out;
}

/**
 * Remove `#[cfg(test)]` modules and items so test-only fields cannot prove evidence.
 */
export function stripCfgTestRust(source: string): string {
  const stripped = stripRustComments(source);
  // Module form: #[cfg(test)]\nmod name { ... } with nested braces
  let out = "";
  let i = 0;
  const marker = "#[cfg(test)]";
  while (i < stripped.length) {
    if (stripped.startsWith(marker, i)) {
      i += marker.length;
      while (i < stripped.length && /\s/.test(stripped[i]!)) i++;
      // Skip attributes stacked on the same item
      while (stripped.startsWith("#[", i)) {
        const endAttr = stripped.indexOf("]", i);
        if (endAttr < 0) break;
        i = endAttr + 1;
        while (i < stripped.length && /\s/.test(stripped[i]!)) i++;
      }
      if (stripped.startsWith("mod ", i) || stripped.startsWith("fn ", i)) {
        const brace = stripped.indexOf("{", i);
        if (brace < 0) {
          // semicolon item: fn foo();
          const semi = stripped.indexOf(";", i);
          i = semi < 0 ? stripped.length : semi + 1;
          continue;
        }
        let depth = 0;
        let j = brace;
        for (; j < stripped.length; j++) {
          if (stripped[j] === "{") depth++;
          else if (stripped[j] === "}") {
            depth--;
            if (depth === 0) {
              j++;
              break;
            }
          }
        }
        i = j;
        continue;
      }
      // cfg(test) on a struct/const/impl — skip until next top-level-ish item is hard;
      // treat as skip through the following braced block or to semicolon.
      const brace = stripped.indexOf("{", i);
      const semi = stripped.indexOf(";", i);
      if (brace >= 0 && (semi < 0 || brace < semi)) {
        let depth = 0;
        let j = brace;
        for (; j < stripped.length; j++) {
          if (stripped[j] === "{") depth++;
          else if (stripped[j] === "}") {
            depth--;
            if (depth === 0) {
              j++;
              break;
            }
          }
        }
        i = j;
        continue;
      }
      if (semi >= 0) {
        i = semi + 1;
        continue;
      }
      continue;
    }
    out += stripped[i];
    i++;
  }
  return out;
}

function walkRsFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "target") continue;
      walkRsFiles(full, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".rs")) out.push(full);
  }
}

/**
 * Concatenate non-test Rust under scope roots. Injectable bodies for plants.
 */
export function loadScopedRustText(
  scopeRoots: readonly string[],
  fileContents?: ReadonlyMap<string, string>,
): string {
  if (fileContents != null) {
    return [...fileContents.values()]
      .map((t) => stripCfgTestRust(t))
      .join("\n");
  }
  const parts: string[] = [];
  for (const root of scopeRoots) {
    const files: string[] = [];
    walkRsFiles(root, files);
    for (const f of files.sort()) {
      parts.push(stripCfgTestRust(fs.readFileSync(f, "utf8")));
    }
  }
  return parts.join("\n");
}

export function scopedRustHasStructField(
  rustText: string,
  structName: string,
  fieldName: string,
): boolean {
  const re = new RegExp(
    String.raw`pub\s+struct\s+${structName}\s*\{([^}]*)\}`,
    "gs",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(rustText)) != null) {
    const body = m[1]!;
    if (
      new RegExp(String.raw`\bpub\s+(?:[\w:<>,\s\[\]]+\s+)?${fieldName}\s*:`).test(
        body,
      ) ||
      new RegExp(String.raw`\b${fieldName}\s*:`).test(body)
    ) {
      return true;
    }
  }
  return false;
}

export function scopedRustHasPubConst(
  rustText: string,
  constName: string,
): boolean {
  return new RegExp(
    String.raw`pub\s+const\s+${constName}\b`,
  ).test(rustText);
}

export type EvidenceContext = {
  ixManifest: IxManifestLike;
  stateManifest: StateManifestLike;
  /** Optional plant: capability → scoped rust text override. */
  scopedRustByCapability?: ReadonlyMap<SurfaceCapability, string>;
  /** Optional plant: capability → scope roots override. */
  scopeRootsByCapability?: ReadonlyMap<SurfaceCapability, readonly string[]>;
  /** Optional plant: foreign program id set override. */
  foreignProgramIds?: ReadonlySet<string>;
};

function evidencePresentForCapability(
  capability: SurfaceCapability,
  ev: SurfaceEvidence,
  ctx: EvidenceContext,
): boolean {
  const resolveRoots = (): string[] | null => {
    if (ctx.scopeRootsByCapability?.get(capability) != null) {
      return [...ctx.scopeRootsByCapability.get(capability)!];
    }
    return resolveCapabilityScopeRoots(capability);
  };
  const resolveRust = (roots: readonly string[]): string =>
    stripCfgTestRust(
      ctx.scopedRustByCapability?.get(capability) ??
        loadScopedRustText(roots),
    );

  if (ev.source === "foreign_field") {
    const roots = resolveRoots();
    if (roots == null) return false;
    const rust = resolveRust(roots);
    const foreignIds =
      ctx.foreignProgramIds ?? loadForeignProgramIds();
    return foreignFieldEvidencePresent(ev.item, rust, foreignIds);
  }

  for (const item of evidenceItems(ev)) {
    if (ev.source === "ix") {
      const enums = capabilityScopeEnums(capability);
      if (enums.length === 0) return false;
      if (
        !enums.every((en) =>
          extractIxNamesInEnum(ctx.ixManifest, en).has(item),
        )
      ) {
        return false;
      }
      continue;
    }
    if (ev.source === "state") {
      if (!item.includes(".")) return false;
      const [layout, field] = item.split(".", 2);
      if (!extractStateFields(ctx.stateManifest, layout!).has(field!)) {
        return false;
      }
      continue;
    }
    if (ev.source === "struct_field" || ev.source === "const") {
      const roots = resolveRoots();
      if (roots == null) {
        // state-only bound fallback for single-enum via boundProgramRelDir
        const programRel = boundProgramRelDir(capability);
        if (programRel == null) return false;
        const fallback = resolveProgramScopeRoots(programRel);
        const rust = resolveRust(fallback);
        if (ev.source === "const") {
          if (!scopedRustHasPubConst(rust, item)) return false;
          continue;
        }
        if (!item.includes(".")) return false;
        const [structName, fieldName] = item.split(".", 2);
        if (!scopedRustHasStructField(rust, structName!, fieldName!)) {
          return false;
        }
        continue;
      }
      const rust = resolveRust(roots);
      if (ev.source === "const") {
        if (!scopedRustHasPubConst(rust, item)) return false;
        continue;
      }
      if (!item.includes(".")) return false;
      const [structName, fieldName] = item.split(".", 2);
      if (!scopedRustHasStructField(rust, structName!, fieldName!)) {
        return false;
      }
      continue;
    }
    if (ev.source === "chain") {
      if (item.length === 0) return false;
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Class-A reads and chain facts: evidence present. Program write counterparts
 * are derived live by assertWriteCounterpartMatchesCell.
 * Reads must not cite instruction names (`source: "ix"`).
 */
export function assertClassAEvidencePresent(
  meta: readonly SurfaceCensusCapabilityMeta[],
  ixManifest: IxManifestLike,
  stateManifest: StateManifestLike,
  ctx: Omit<EvidenceContext, "ixManifest" | "stateManifest"> = {},
): void {
  const fullCtx: EvidenceContext = {
    ixManifest,
    stateManifest,
    ...ctx,
  };
  for (const row of meta) {
    const cls = surfaceClassOf(row.id);
    if (cls === "C" || cls === "B") continue;
    if (
      row.kind === "write_action" &&
      !isSurfaceChainFactCapability(row.id)
    ) {
      continue;
    }
    assert.ok(row.evidence != null, `class-A evidence null for ${row.id}`);
    const ev = row.evidence!;
    if (row.kind === "read_fact" && ev.source === "ix") {
      assert.fail(
        `class-A read must not cite ix name: ${row.id} → ${evidenceItems(ev).join(",")}`,
      );
    }
    if (ev.source === "chain") {
      assert.ok(
        isSurfaceChainFactCapability(row.id),
        `chain evidence only for chain-fact capabilities: ${row.id}`,
      );
      for (const item of evidenceItems(ev)) {
        assert.ok(
          isSurfaceChainEvidenceItem(item),
          `chain evidence item not allowlisted: ${item}`,
        );
      }
    }
    assert.ok(
      evidencePresentForCapability(row.id, ev, fullCtx),
      `class-A evidence missing for ${row.id}: ${ev.source}:${evidenceItems(ev).join(",")}`,
    );
  }
}

/**
 * Class B: derived items absent from the scoped ix enum.
 * Fixture carries no B evidence payload — derive is the only path.
 */
export function assertNotInProgramAbsent(
  classBCapabilities: readonly SurfaceCapability[],
  mappedPairs: readonly MappedCensusPair[],
  ixManifest: IxManifestLike,
): void {
  for (const capability of classBCapabilities) {
    const pairs = mappedPairs.filter(
      (pair) =>
        pair.capability === capability &&
        pair.functionName != null &&
        pair.abiId != null &&
        !SURFACE_SUPPORT_SESSION_LIKE.has(pair.primitive),
    );
    let scopeEnums: readonly string[];
    let items: string[];
    if (pairs.length > 0) {
      const derived = deriveClassBEvidence(capability, mappedPairs, ixManifest);
      scopeEnums = [derived.scopeEnum];
      items = derived.items;
    } else {
      const cross = correspondenceRowsForCapability(capability).find(
        (row) => row.svmEnums.length > 1,
      );
      const bound = CAPABILITY_BOUND_ENUM[capability];
      assert.ok(
        cross != null || bound != null,
        `capability not program-bound: ${capability}`,
      );
      scopeEnums = cross?.svmEnums ?? [bound!];
      const correspondenceItems = correspondenceRowsForCapability(capability)
        .flatMap((row) => row.svmVariant);
      items = [
        ...new Set(
          correspondenceItems.length > 0
            ? correspondenceItems
            : reverseAbiFunctions(capability, bound).map(({ fn }) =>
                toPascalCaseFunctionName(fn),
              ),
        ),
      ].sort();
      if (
        items.length === 0 &&
        SURFACE_CAPABILITY_KIND[capability] === "read_fact"
      ) {
        // Class-B read with no EVM function counterpart — null evidence + cell.
        continue;
      }
      assert.ok(items.length > 0, `class-B no derivable item for ${capability}`);
    }
    for (const scopeEnum of scopeEnums) {
      const scoped = extractIxNamesInEnum(ixManifest, scopeEnum);
      for (const item of items) {
        assert.ok(
          !scoped.has(item),
          `not_in_program item unexpectedly present: ${item} in ${scopeEnum}`,
        );
      }
    }
  }
}

export function assertDerivationNonEmpty(
  derived: readonly unknown[],
): void {
  assert.ok(derived.length > 0, "derived consumer set must not be empty");
}

export function assertMatrixEqual(
  forCapability: unknown,
  bare: unknown,
  detail: string,
): void {
  assert.deepEqual(forCapability, bare, detail);
}

export function assertSessionGatesKnown(
  live: readonly string[],
  known: readonly string[],
): void {
  const knownSet = new Set(known);
  const liveSet = new Set(live);
  for (const f of live) {
    assert.ok(
      knownSet.has(f),
      `unexpected session gate without writes: ${f}`,
    );
  }
  for (const f of known) {
    assert.ok(
      liveSet.has(f),
      `known session gate missing from live derivation: ${f}`,
    );
  }
}
