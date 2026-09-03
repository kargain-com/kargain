import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertEventDispositionCoverage,
  COMMERCIAL_CONTRACT_ABIS,
  listCommercialAbiEvents,
  type EventDispositionsFile,
} from "../lib/svm/commercial-abi-events.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

type AbiParam = {
  readonly name?: string;
  readonly type: string;
  readonly internalType?: string;
};

type AbiItem = {
  readonly type?: string;
  readonly name?: string;
  readonly inputs?: readonly AbiParam[];
};

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

type PonderRegistration = {
  contract: string;
  event: string;
  handlerFile: string;
  handlerEmpty: boolean;
};

const GATEWAY_REQUIRED_EVENTS = ["ONFTSent", "ONFTReceived"] as const;

const BYTES32_UINT256_NAMES = new Set([
  "tokenId",
  "subjectId",
  "_fromTokenId",
  "_toTokenId",
]);

const MONEY_FIELD =
  /(?:amount|price|floor|bond|fee|stake|deposit|bid|gross|net|total|value|tolerance|commission|paid|refund|credit|split|asset|fiat|native|usd|wei|min|max|bps|rate|share|leg|payout|proceeds|cost|charge|penalty|forfeit|reward|balance|quantity|qty|newPrice|oldPrice|baseFiat|baseAsset|bondAmount|verificationFee|disputeDeposit|minStake|claim)/i;

const TIME_FIELD =
  /(?:At|Duration|window|deadline|ends|remaining|timestamp|time|seconds|slot|period|protection|abandonment|unbond|recall|staleness|opened|closed|settled|released|started|completed|abandoned|judged|concluded|withdrawn|expires|expiry|elapsed|delay|interval|epoch)/i;

function stripJsComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("//", i)) {
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      i += 2;
      while (i < source.length && !source.startsWith("*/", i)) i += 1;
      i += 2;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

function isHandlerBodyEmpty(body: string): boolean {
  return stripJsComments(body).trim().length === 0;
}

function findMatchingBrace(source: string, openBraceIndex: number): number {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unbalanced braces near index ${openBraceIndex}`);
}

function parsePonderRegistrations(relativeFile: string): PonderRegistration[] {
  const absoluteFile = path.join(REPO_ROOT, relativeFile);
  const source = fs.readFileSync(absoluteFile, "utf8");
  const registrations: PonderRegistration[] = [];
  const needle = 'ponder.on("';
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const start = source.indexOf(needle, searchFrom);
    if (start === -1) break;

    const quoteStart = start + needle.length - 1;
    const quoteEnd = source.indexOf('"', quoteStart + 1);
    if (quoteEnd === -1) break;

    const contractEvent = source.slice(quoteStart + 1, quoteEnd);
    const splitAt = contractEvent.indexOf(":");
    if (splitAt === -1) {
      throw new Error(`Invalid ponder.on target in ${relativeFile}: ${contractEvent}`);
    }

    const contract = contractEvent.slice(0, splitAt);
    const event = contractEvent.slice(splitAt + 1);

    if (!Object.hasOwn(COMMERCIAL_CONTRACT_ABIS, contract) || !/^[A-Za-z0-9_]+$/.test(event)) {
      searchFrom = quoteEnd + 1;
      continue;
    }

    const arrowIdx = source.indexOf("=>", quoteEnd);
    if (arrowIdx === -1) {
      throw new Error(`Missing handler arrow for ${contractEvent} in ${relativeFile}`);
    }

    const bodyOpen = source.indexOf("{", arrowIdx);
    if (bodyOpen === -1) {
      throw new Error(`Missing handler body for ${contractEvent} in ${relativeFile}`);
    }

    const bodyClose = findMatchingBrace(source, bodyOpen);
    const body = source.slice(bodyOpen + 1, bodyClose);

    registrations.push({
      contract,
      event,
      handlerFile: relativeFile,
      handlerEmpty: isHandlerBodyEmpty(body),
    });

    searchFrom = bodyClose + 1;
  }

  return registrations;
}

function normalizeSolidityType(input: AbiParam): string {
  const internal = input.internalType?.trim();
  const type = input.type.trim();
  if (internal?.startsWith("enum ")) return "enum";
  return type;
}

function mapEncoding(fieldName: string, solidityType: string): string {
  switch (solidityType) {
    case "address":
      return "pubkey32";
    case "bytes32":
      return "bytes32";
    case "string":
      return "borsh_string";
    case "uint16":
      return "u16";
    case "uint8":
    case "enum":
      return "u8";
    case "bool":
      return "u8";
    case "uint64":
      return "u64";
    case "uint128":
      return "u64";
    case "uint32":
      return "u32";
    case "uint40":
      return "u64";
    case "uint256": {
      if (BYTES32_UINT256_NAMES.has(fieldName)) return "bytes32";
      if (MONEY_FIELD.test(fieldName) || TIME_FIELD.test(fieldName)) return "u64";
      throw new Error(
        `Unmapped uint256 event field "${fieldName}" — add bytes32 id or u64 money/time rule`,
      );
    }
    default:
      throw new Error(`Unmapped solidity type "${solidityType}" for field "${fieldName}"`);
  }
}

function lookupEventAbi(contract: string, eventName: string): AbiItem {
  if (!Object.hasOwn(COMMERCIAL_CONTRACT_ABIS, contract)) {
    throw new Error(`No ABI export mapped for contract ${contract}`);
  }
  const abi = COMMERCIAL_CONTRACT_ABIS[
    contract as keyof typeof COMMERCIAL_CONTRACT_ABIS
  ];

  const item = abi.find((entry) => entry.type === "event" && entry.name === eventName);
  if (!item) {
    throw new Error(`Event ${contract}:${eventName} not found in ABI`);
  }
  return item as AbiItem;
}

function buildEntry(registration: PonderRegistration): ManifestEntry {
  const abiEvent = lookupEventAbi(registration.contract, registration.event);
  const fields = (abiEvent.inputs ?? []).map((input) => {
    const name = input.name ?? "";
    const solidityType = normalizeSolidityType(input);
    return {
      name,
      solidityType,
      encoding: mapEncoding(name, solidityType),
    };
  });

  return {
    contract: registration.contract,
    event: registration.event,
    handlerFile: registration.handlerFile,
    handlerEmpty: registration.handlerEmpty,
    fields,
  };
}

function buildGatewayRequiredEntry(eventName: (typeof GATEWAY_REQUIRED_EVENTS)[number]): ManifestEntry {
  const abiEvent = lookupEventAbi("KarPassportBridgeGateway", eventName);
  const fields = (abiEvent.inputs ?? []).map((input) => {
    const name = input.name ?? "";
    const solidityType = normalizeSolidityType(input);
    return {
      name,
      solidityType,
      encoding: mapEncoding(name, solidityType),
    };
  });

  return {
    contract: "KarPassportBridgeGateway",
    event: eventName,
    handlerFile: "",
    handlerEmpty: true,
    fields,
  };
}

function sortEntries(entries: ManifestEntry[]): ManifestEntry[] {
  return [...entries].sort((a, b) => {
    const contractCmp = a.contract.localeCompare(b.contract);
    if (contractCmp !== 0) return contractCmp;
    return a.event.localeCompare(b.event);
  });
}

function contractSnake(contract: string): string {
  return contract
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function eventSnake(event: string): string {
  return event.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function rustType(encoding: string): string {
  switch (encoding) {
    case "pubkey32":
    case "bytes32":
      return "[u8; 32]";
    case "u64":
      return "u64";
    case "u32":
      return "u32";
    case "u16":
      return "u16";
    case "u8":
      return "u8";
    case "borsh_string":
      return "String";
    default:
      throw new Error(`Unknown encoding for Rust type: ${encoding}`);
  }
}

const OWNER_PROGRAM: Record<string, string> = {
  KarPassport: "kar-passport",
  KarProStaking: "kar-pro-staking",
  KarProPass: "kar-pro-pass",
  FixedPriceConsignment: "kar-fixed-price",
  AscendingConsignment: "kar-ascending",
  KarPassportBridgeGateway: "kar-gateway",
};

const COMMERCE_EVENTS = new Set([
  "ConsignmentOpened",
  "ConsignmentPriceSet",
  "ConsignmentFloorLowered",
  "ConsignmentCommissionLowered",
  "ConsignmentClosed",
  "ConsignmentSplitPaid",
  "MandateGranted",
  "MandateRevoked",
  "RecallRequested",
  "Paused",
  "Unpaused",
  "GuardianSet",
]);

const CHALLENGE_EVENTS = new Set([
  "ChallengeOpened",
  "ChallengeWithdrawn",
  "ChallengeJudged",
  "ChallengeConcluded",
  "ChallengeExpired",
]);

const PAYOUT_EMITTER_TAG: Record<string, string> = {
  KarPassport: "PayoutEmitter::KarPassport",
  KarProStaking: "PayoutEmitter::KarProStaking",
  FixedPriceConsignment: "PayoutEmitter::FixedPriceConsignment",
  AscendingConsignment: "PayoutEmitter::AscendingConsignment",
};

const CHALLENGE_EMITTER_TAG: Record<string, string> = {
  KarPassport: "ChallengeEmitter::KarPassport",
  AscendingConsignment: "ChallengeEmitter::AscendingConsignment",
};

type EmitRequirement = {
  contract: string;
  event: string;
  ownerProgram: string;
  proof: string;
  proofTag?: string;
};

function buildEmitRequirement(entry: ManifestEntry): EmitRequirement {
  const ownerProgram = OWNER_PROGRAM[entry.contract];
  if (!ownerProgram) {
    throw new Error(`No ownerProgram for contract ${entry.contract}`);
  }
  if (entry.event === "ClaimRecorded" || entry.event === "ClaimWithdrawn") {
    const proofTag = PAYOUT_EMITTER_TAG[entry.contract];
    if (!proofTag) {
      throw new Error(`No PayoutEmitter tag for ${entry.contract}:${entry.event}`);
    }
    return { contract: entry.contract, event: entry.event, ownerProgram, proof: "emit_payout", proofTag };
  }
  if (CHALLENGE_EVENTS.has(entry.event)) {
    const proofTag = CHALLENGE_EMITTER_TAG[entry.contract];
    if (!proofTag) {
      throw new Error(`No ChallengeEmitter tag for ${entry.contract}:${entry.event}`);
    }
    return { contract: entry.contract, event: entry.event, ownerProgram, proof: "emit_challenge", proofTag };
  }
  if (COMMERCE_EVENTS.has(entry.event)) {
    return { contract: entry.contract, event: entry.event, ownerProgram, proof: "emit_commerce" };
  }
  const proof = `emit_${contractSnake(entry.contract)}_${eventSnake(entry.event)}`;
  return { contract: entry.contract, event: entry.event, ownerProgram, proof };
}

function generateRust(manifest: { entries: ManifestEntry[] }): string {
  const lines: string[] = [
    "// Auto-generated by scripts/generate-svm-event-manifest.ts — do not edit manually",
    "",
    "use borsh::BorshSerialize;",
    "use super::emit_program_data;",
    "",
  ];

  for (const entry of manifest.entries) {
    const fnName = `emit_${contractSnake(entry.contract)}_${eventSnake(entry.event)}`;
    const params = entry.fields
      .map((f) => `${f.name}: ${rustType(f.encoding)}`)
      .join(", ");
    const serializeLines = entry.fields.map(
      (f) => `    ${f.name}.serialize(&mut body).expect("event field serialize");`,
    );
    lines.push(`/// ${entry.contract}:${entry.event}`);
    lines.push(`pub fn ${fnName}(${params}) {`);
    lines.push("    let mut body = Vec::new();");
    lines.push(...serializeLines);
    lines.push(`    emit_program_data("${entry.event}", &body);`);
    lines.push("}");
    lines.push("");
  }

  lines.push("/// Stable registry for parity tests — (contract, event) pairs.");
  lines.push("pub const REGISTRY: &[(&str, &str)] = &[");
  for (const entry of manifest.entries) {
    lines.push(`    ("${entry.contract}", "${entry.event}"),`);
  }
  lines.push("];");
  lines.push("");

  return lines.join("\n");
}

function main(): void {
  const handlerFiles = ["src/index.ts", "src/commerce-handlers.ts"] as const;
  const registrations = handlerFiles.flatMap((file) => parsePonderRegistrations(file));

  const seen = new Set<string>();
  const entries: ManifestEntry[] = [];

  for (const registration of registrations) {
    const key = `${registration.contract}:${registration.event}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate ponder registration for ${key}`);
    }
    seen.add(key);
    entries.push(buildEntry(registration));
  }

  for (const eventName of GATEWAY_REQUIRED_EVENTS) {
    const key = `KarPassportBridgeGateway:${eventName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(buildGatewayRequiredEntry(eventName));
  }

  const manifest = { entries: sortEntries(entries) };
  const crateDir = path.join(REPO_ROOT, "svm/crates/kargain-events");
  fs.mkdirSync(crateDir, { recursive: true });
  fs.mkdirSync(path.join(crateDir, "src"), { recursive: true });

  const manifestPath = path.join(crateDir, "events.manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const generatedPath = path.join(crateDir, "src/generated.rs");
  fs.writeFileSync(generatedPath, `${generateRust(manifest)}\n`, "utf8");

  const requirements = manifest.entries.map(buildEmitRequirement);
  const requirementsPath = path.join(crateDir, "emit-requirements.json");
  fs.writeFileSync(requirementsPath, `${JSON.stringify({ entries: requirements }, null, 2)}\n`, "utf8");

  console.log(`Wrote ${manifest.entries.length} entries to ${path.relative(REPO_ROOT, manifestPath)}`);
  console.log(`Wrote generated Rust to ${path.relative(REPO_ROOT, generatedPath)}`);
  console.log(`Wrote emit requirements to ${path.relative(REPO_ROOT, requirementsPath)}`);

  const divergencesPath = path.join(crateDir, "named-divergences.json");
  const dispositionsPath = path.join(crateDir, "event-dispositions.json");
  const divergences = JSON.parse(fs.readFileSync(divergencesPath, "utf8")) as Array<{
    contract: string;
    event: string;
    specId: string;
  }>;
  const dispositions = JSON.parse(
    fs.readFileSync(dispositionsPath, "utf8"),
  ) as EventDispositionsFile;

  assertEventDispositionCoverage({
    abiEvents: listCommercialAbiEvents(),
    manifestEntries: manifest.entries,
    namedDivergences: divergences.map((d) => ({
      contract: d.contract,
      event: d.event,
      specId: d.specId,
    })),
    dispositions,
  });
  console.log(
    `Event disposition coverage OK (${listCommercialAbiEvents().length} ABI events)`,
  );

  const disc = spawnSync(
    "node",
    ["--import", "tsx", "scripts/generate-svm-event-discriminators.ts"],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  if (disc.status !== 0) process.exit(disc.status ?? 1);
}

main();
