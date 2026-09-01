/**
 * S7a structured event surface — program proof linkage + crate payload accounting.
 *
 * Census source: handler-derived manifest + emit-requirements.json (generator output).
 * Wire owner: svm/crates/kargain-events (encode + sol_log_data only).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
  KarPassportAbi,
  KarPassportBridgeGatewayAbi,
  KarProPassAbi,
  KarProStakingAbi,
} from "../lib/contracts/abis.generated.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(ROOT, "svm/crates/kargain-events/events.manifest.json");
const REQUIREMENTS_PATH = path.join(ROOT, "svm/crates/kargain-events/emit-requirements.json");
const DIVERGENCES_PATH = path.join(ROOT, "svm/crates/kargain-events/named-divergences.json");
const GENERATED_RS = path.join(ROOT, "svm/crates/kargain-events/src/generated.rs");
const EVENTS_LIB = path.join(ROOT, "svm/crates/kargain-events/src/lib.rs");
const EVENTS_SRC = path.join(ROOT, "svm/crates/kargain-events/src");
const SVM = path.join(ROOT, "svm");

type ManifestField = {
  name: string;
  solidityType: string;
  encoding: string;
};

type ManifestEntry = {
  contract: string;
  event: string;
  handlerFile: string;
  handlerEmpty: boolean;
  fields: ManifestField[];
};

type EmitRequirement = {
  contract: string;
  event: string;
  ownerProgram: string;
  proof: string;
  proofTag?: string;
};

type NamedDivergence = {
  contract: string;
  event: string;
  specId: string;
  module?: string;
  proof?: string;
};

type AbiEventInput = { name: string; type: string; indexed?: boolean };

const CONTRACT_ABIS: Record<string, readonly { type?: string; name?: string; inputs?: AbiEventInput[] }[]> = {
  KarPassport: KarPassportAbi,
  KarProStaking: KarProStakingAbi,
  KarProPass: KarProPassAbi,
  FixedPriceConsignment: FixedPriceConsignmentAbi,
  AscendingConsignment: AscendingConsignmentAbi,
  KarPassportBridgeGateway: KarPassportBridgeGatewayAbi,
};

function rg(pattern: string, cwd: string, globs: string[]): string {
  try {
    return execFileSync(
      "rg",
      ["-n", "--glob", "!**/target/**", ...globs.flatMap((g) => ["--glob", g]), pattern, cwd],
      { encoding: "utf8" },
    );
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string };
    if (err.status === 1) return "";
    throw e;
  }
}

function parseRegistryFromGenerated(source: string): Array<{ contract: string; event: string }> {
  const rows: Array<{ contract: string; event: string }> = [];
  const re = /\("([^"]+)", "([^"]+)"\)/g;
  const block = source.slice(source.indexOf("pub const REGISTRY"));
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    rows.push({ contract: m[1]!, event: m[2]! });
  }
  return rows;
}

function abiEventFields(contract: string, eventName: string): string[] {
  const abi = CONTRACT_ABIS[contract];
  assert.ok(abi, `missing ABI for ${contract}`);
  const item = abi.find((x) => x.type === "event" && x.name === eventName);
  assert.ok(item, `${contract}:${eventName} not in abis.generated.ts`);
  return (item.inputs ?? []).map((i) => i.name);
}

function key(contract: string, event: string): string {
  return `${contract}:${event}`;
}

function walkRs(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkRs(p));
    else if (ent.name.endsWith(".rs")) out.push(p);
  }
  return out;
}

function readProgramSources(ownerProgram: string): string {
  const srcDir = path.join(SVM, "programs", ownerProgram, "src");
  assert.ok(fs.existsSync(srcDir), `missing program src for ${ownerProgram}`);
  return walkRs(srcDir).map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

/** Exported for constructed-violation discipline in-suite. */
export function programSourcesContainProof(
  sources: string,
  req: Pick<EmitRequirement, "proof" | "proofTag">,
): boolean {
  if (!sources.includes(req.proof)) return false;
  if (req.proofTag && !sources.includes(req.proofTag)) return false;
  return true;
}

function scanCratePayloadEventNames(): Array<{ file: string; event: string }> {
  const out: Array<{ file: string; event: string }> = [];
  for (const file of walkRs(EVENTS_SRC)) {
    const base = path.basename(file);
    if (base === "generated.rs" || base === "lib.rs") continue;
    const src = fs.readFileSync(file, "utf8");
    const emitRe = /emit_program_data\s*\(\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = emitRe.exec(src)) !== null) {
      out.push({ file: path.relative(ROOT, file), event: m[1]! });
    }
  }
  return out;
}

describe("svm-event-parity-policy", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as {
    entries: ManifestEntry[];
  };
  const requirements = JSON.parse(fs.readFileSync(REQUIREMENTS_PATH, "utf8")) as {
    entries: EmitRequirement[];
  };
  const divergences = JSON.parse(fs.readFileSync(DIVERGENCES_PATH, "utf8")) as NamedDivergence[];
  const generated = fs.readFileSync(GENERATED_RS, "utf8");
  const registry = parseRegistryFromGenerated(generated);

  it("generator manifest determinism: manifest ↔ generated REGISTRY are identical sets", () => {
    const manifestKeys = new Set(manifest.entries.map((e) => key(e.contract, e.event)));
    const registryKeys = new Set(registry.map((e) => key(e.contract, e.event)));
    assert.deepEqual(registryKeys, manifestKeys);
    assert.equal(registry.length, manifest.entries.length);
    assert.equal(requirements.entries.length, manifest.entries.length);
  });

  it("EVM → SVM: every census row has manifest fields matching ABI declaration order", () => {
    for (const entry of manifest.entries) {
      const abiFields = abiEventFields(entry.contract, entry.event);
      const manifestFields = entry.fields.map((f) => f.name);
      assert.deepEqual(
        manifestFields,
        abiFields,
        `${entry.contract}:${entry.event} field order must match ABI`,
      );
      for (const f of entry.fields) {
        assert.ok(f.encoding, `${entry.contract}:${entry.event}.${f.name} missing encoding`);
      }
    }
  });

  it("every manifest row has emit-requirements ownerProgram + proof", () => {
    const manifestKeys = new Set(manifest.entries.map((e) => key(e.contract, e.event)));
    const reqKeys = new Set(requirements.entries.map((e) => key(e.contract, e.event)));
    assert.deepEqual(reqKeys, manifestKeys);
    for (const req of requirements.entries) {
      assert.ok(req.ownerProgram, `${req.contract}:${req.event} missing ownerProgram`);
      assert.ok(req.proof, `${req.contract}:${req.event} missing proof`);
    }
  });

  it("owner program sources contain proof for every census row with SVM emission", () => {
    const divergedKeys = new Set(divergences.map((d) => key(d.contract, d.event)));
    const byProgram = new Map<string, string>();
    for (const req of requirements.entries) {
      if (divergedKeys.has(key(req.contract, req.event))) continue;
      if (!byProgram.has(req.ownerProgram)) {
        byProgram.set(req.ownerProgram, readProgramSources(req.ownerProgram));
      }
      const sources = byProgram.get(req.ownerProgram)!;
      assert.ok(
        programSourcesContainProof(sources, req),
        `${req.ownerProgram} missing proof ${req.proof}${req.proofTag ? ` + ${req.proofTag}` : ""} for ${req.contract}:${req.event}`,
      );
    }
  });

  it("constructed violation: synthetic fixture missing proof fails the scanner", () => {
    const req: EmitRequirement = {
      contract: "FixedPriceConsignment",
      event: "Bought",
      ownerProgram: "kar-fixed-price",
      proof: "emit_fixed_price_consignment_bought",
    };
    const clean = readProgramSources(req.ownerProgram);
    assert.ok(programSourcesContainProof(clean, req));
    const dirty = clean.replace(req.proof, "emit_removed_for_test");
    assert.ok(!programSourcesContainProof(dirty, req));
  });

  it("non-generated kargain-events payloads map to census or named divergence", () => {
    const census = new Set(manifest.entries.map((e) => key(e.contract, e.event)));
    const diverged = new Map(
      divergences.map((d) => [key(d.contract, d.event), d] as const),
    );
    const payloads = scanCratePayloadEventNames();
    assert.ok(payloads.length > 0, "expected hand-written payload modules beside generated.rs");
    for (const row of payloads) {
      const div = [...diverged.values()].find((d) => d.event === row.event);
      if (div) {
        assert.ok(div.specId.length > 0);
        continue;
      }
      const censusHit = [...census].some((k) => k.endsWith(`:${row.event}`));
      assert.ok(
        censusHit,
        `payload event ${row.event} in ${row.file} has no census row and no named divergence`,
      );
    }
  });

  it("named divergences are registered with SPEC ids", () => {
    assert.equal(divergences.length, 5);
    const ids = divergences.map((d) => d.specId).sort();
    assert.deepEqual(ids, ["D-38", "D-39", "D-40", "D-41", "D-42"]);
    for (const d of divergences) {
      assert.ok(d.specId.length > 0);
    }
  });

  it("generated emit fn exists for every manifest entry", () => {
    for (const entry of manifest.entries) {
      const contractSnake = entry.contract
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
        .toLowerCase();
      const eventSnake = entry.event.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
      const fn = `emit_${contractSnake}_${eventSnake}`;
      assert.ok(generated.includes(`pub fn ${fn}(`), `missing generated emitter ${fn}`);
    }
  });

  it("sole sol_log_data owner: only kargain-events/src/lib.rs", () => {
    const hit = rg(String.raw`sol_log_data\s*\(`, SVM, ["*.rs"]);
    const lines = hit
      .split("\n")
      .filter((l) => l.trim())
      .filter((l) => !l.includes("kargain-events/src/lib.rs"));
    assert.equal(lines.join("\n").trim(), "", `sol_log_data outside owner:\n${lines.join("\n")}`);
  });

  it("programs route structured emission through kargain_events (not inline encode)", () => {
    const programs = path.join(SVM, "programs");
    const hit = rg(String.raw`emit_program_data\s*\(`, programs, ["*.rs"]);
    assert.equal(hit.trim(), "", `inline emit_program_data in programs:\n${hit}`);
    const uses = rg(String.raw`kargain_events::`, programs, ["*.rs"]);
    assert.ok(uses.trim().length > 0, "programs must import kargain_events");
  });

  it("domain crates route challenge/payout/consignment through emit modules", () => {
    const bc = fs.readFileSync(
      path.join(SVM, "crates/kargain-bonded-challenge/src/emit.rs"),
      "utf8",
    );
    assert.ok(bc.includes("kargain_events::generated"));
    const cp = fs.readFileSync(
      path.join(SVM, "crates/kargain-claimable-payouts/src/emit.rs"),
      "utf8",
    );
    assert.ok(cp.includes("kargain_events::generated"));
    const cb = fs.readFileSync(path.join(SVM, "crates/kargain-consignment-base/src/emit.rs"), "utf8");
    assert.ok(cb.includes("kargain_events::generated"));
  });

  it("choke-point owner file exists and exports emit_program_data", () => {
    const lib = fs.readFileSync(EVENTS_LIB, "utf8");
    assert.ok(lib.includes("pub fn emit_program_data"));
    assert.ok(lib.includes("pub mod generated"));
  });
});
