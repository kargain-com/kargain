/**
 * Sole enumerator + disposition validator for the six commercial contract ABIs (S7-event-disposition).
 */
import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
  KarPassportAbi,
  KarPassportBridgeGatewayAbi,
  KarProPassAbi,
  KarProStakingAbi,
} from "@/lib/contracts/abis.generated";

export type CommercialContractName =
  | "KarPassport"
  | "KarProStaking"
  | "KarProPass"
  | "FixedPriceConsignment"
  | "AscendingConsignment"
  | "KarPassportBridgeGateway";

export type AbiEventRef = {
  contract: CommercialContractName;
  event: string;
};

export type ManifestEntryRef = {
  contract: string;
  event: string;
};

export type NamedDivergenceRef = {
  contract: string;
  event: string;
  specId: string;
};

export type OutOfScopeDisposition = {
  contract: string;
  event: string;
  reasonClass: string;
  rationale: string;
  /** When EVM emits a duplicate signal; indexer uses this census sibling instead. */
  supersededBy?: { contract: string; event: string };
};

export type EventDispositionsFile = {
  reasonClasses: Record<string, string>;
  outOfScope: OutOfScopeDisposition[];
};

export type EventDispositionKind = "census" | "named_divergence" | "out_of_scope";

export type ResolvedEventDisposition =
  | {
      kind: "census";
      contract: string;
      event: string;
      /** When a named divergence annotates a census row (D-40–D-42). */
      divergenceSpecId?: string;
    }
  | { kind: "named_divergence"; contract: string; event: string; specId: string }
  | {
      kind: "out_of_scope";
      contract: string;
      event: string;
      reasonClass: string;
      rationale: string;
      supersededBy?: { contract: string; event: string };
    };

type AbiItem = { type?: string; name?: string };

export const COMMERCIAL_CONTRACT_ABIS: Record<
  CommercialContractName,
  readonly AbiItem[]
> = {
  KarPassport: KarPassportAbi,
  KarProStaking: KarProStakingAbi,
  KarProPass: KarProPassAbi,
  FixedPriceConsignment: FixedPriceConsignmentAbi,
  AscendingConsignment: AscendingConsignmentAbi,
  KarPassportBridgeGateway: KarPassportBridgeGatewayAbi,
};

export const COMMERCIAL_CONTRACT_NAMES = Object.keys(
  COMMERCIAL_CONTRACT_ABIS,
) as CommercialContractName[];

export function eventKey(contract: string, event: string): string {
  return `${contract}:${event}`;
}

export function listCommercialAbiEvents(): AbiEventRef[] {
  const out: AbiEventRef[] = [];
  for (const contract of COMMERCIAL_CONTRACT_NAMES) {
    const abi = COMMERCIAL_CONTRACT_ABIS[contract];
    for (const item of abi) {
      if (item.type === "event" && item.name) {
        out.push({ contract, event: item.name });
      }
    }
  }
  return out.sort(
    (a, b) =>
      a.contract.localeCompare(b.contract) || a.event.localeCompare(b.event),
  );
}

export function resolveEventDispositions(input: {
  abiEvents: readonly AbiEventRef[];
  manifestEntries: readonly ManifestEntryRef[];
  namedDivergences: readonly NamedDivergenceRef[];
  dispositions: EventDispositionsFile;
}): Map<string, ResolvedEventDisposition> {
  const divergenceByKey = new Map(
    input.namedDivergences.map((d) => [eventKey(d.contract, d.event), d]),
  );
  const censusKeys = new Set(
    input.manifestEntries.map((e) => eventKey(e.contract, e.event)),
  );
  const outOfScopeByKey = new Map(
    input.dispositions.outOfScope.map((row) => [
      eventKey(row.contract, row.event),
      row,
    ]),
  );

  const resolved = new Map<string, ResolvedEventDisposition>();
  for (const { contract, event } of input.abiEvents) {
    const key = eventKey(contract, event);
    const divergence = divergenceByKey.get(key);
    if (censusKeys.has(key)) {
      resolved.set(key, {
        kind: "census",
        contract,
        event,
        ...(divergence ? { divergenceSpecId: divergence.specId } : {}),
      });
      continue;
    }
    if (divergence) {
      resolved.set(key, {
        kind: "named_divergence",
        contract,
        event,
        specId: divergence.specId,
      });
      continue;
    }
    const outOfScope = outOfScopeByKey.get(key);
    if (outOfScope) {
      resolved.set(key, {
        kind: "out_of_scope",
        contract,
        event,
        reasonClass: outOfScope.reasonClass,
        rationale: outOfScope.rationale,
        supersededBy: outOfScope.supersededBy,
      });
      continue;
    }
  }
  return resolved;
}

export type DispositionCoverageProblem =
  | { type: "abi_event_missing_disposition"; contract: string; event: string }
  | { type: "orphan_out_of_scope"; contract: string; event: string }
  | {
      type: "invalid_reason_class";
      contract: string;
      event: string;
      reasonClass: string;
    }
  | {
      type: "superseded_by_not_in_census";
      contract: string;
      event: string;
      supersededBy: { contract: string; event: string };
    }
  | {
      type: "superseded_by_census_event_missing_target";
      contract: string;
      event: string;
    }
  | {
      type: "superseded_by_census_event_missing_pointer";
      contract: string;
      event: string;
    };

export function validateEventDispositionCoverage(input: {
  abiEvents: readonly AbiEventRef[];
  manifestEntries: readonly ManifestEntryRef[];
  namedDivergences: readonly NamedDivergenceRef[];
  dispositions: EventDispositionsFile;
}): DispositionCoverageProblem[] {
  const problems: DispositionCoverageProblem[] = [];
  const abiKeys = new Set(
    input.abiEvents.map((e) => eventKey(e.contract, e.event)),
  );
  const censusKeys = new Set(
    input.manifestEntries.map((e) => eventKey(e.contract, e.event)),
  );
  const allowedReasonClasses = new Set(
    Object.keys(input.dispositions.reasonClasses),
  );

  const resolved = resolveEventDispositions(input);

  for (const { contract, event } of input.abiEvents) {
    const key = eventKey(contract, event);
    if (!resolved.has(key)) {
      problems.push({ type: "abi_event_missing_disposition", contract, event });
    }
  }

  for (const row of input.dispositions.outOfScope) {
    const key = eventKey(row.contract, row.event);
    if (!abiKeys.has(key)) {
      problems.push({
        type: "orphan_out_of_scope",
        contract: row.contract,
        event: row.event,
      });
    }
    if (!allowedReasonClasses.has(row.reasonClass)) {
      problems.push({
        type: "invalid_reason_class",
        contract: row.contract,
        event: row.event,
        reasonClass: row.reasonClass,
      });
    }
    if (row.supersededBy) {
      const siblingKey = eventKey(row.supersededBy.contract, row.supersededBy.event);
      if (!censusKeys.has(siblingKey)) {
        problems.push({
          type: "superseded_by_not_in_census",
          contract: row.contract,
          event: row.event,
          supersededBy: row.supersededBy,
        });
      }
      if (row.reasonClass !== "superseded_by_census_event") {
        problems.push({
          type: "superseded_by_census_event_missing_target",
          contract: row.contract,
          event: row.event,
        });
      }
    }
    if (
      row.reasonClass === "superseded_by_census_event" &&
      !row.supersededBy
    ) {
      problems.push({
        type: "superseded_by_census_event_missing_pointer",
        contract: row.contract,
        event: row.event,
      });
    }
  }

  return problems.sort((a, b) => {
    const ak = `${a.type}:${"contract" in a ? a.contract : ""}:${"event" in a ? a.event : ""}`;
    const bk = `${b.type}:${"contract" in b ? b.contract : ""}:${"event" in b ? b.event : ""}`;
    return ak.localeCompare(bk);
  });
}

export function assertEventDispositionCoverage(
  input: Parameters<typeof validateEventDispositionCoverage>[0],
): void {
  const problems = validateEventDispositionCoverage(input);
  if (problems.length === 0) return;
  const lines = problems.map((p) => {
    switch (p.type) {
      case "abi_event_missing_disposition":
        return `missing disposition: ${p.contract}:${p.event}`;
      case "orphan_out_of_scope":
        return `orphan out_of_scope row: ${p.contract}:${p.event}`;
      case "invalid_reason_class":
        return `invalid reasonClass ${p.reasonClass} on ${p.contract}:${p.event}`;
      case "superseded_by_not_in_census":
        return `${p.contract}:${p.event} supersededBy ${p.supersededBy.contract}:${p.supersededBy.event} not in census`;
      case "superseded_by_census_event_missing_target":
        return `${p.contract}:${p.event} has supersededBy but reasonClass is not superseded_by_census_event`;
      case "superseded_by_census_event_missing_pointer":
        return `${p.contract}:${p.event} superseded_by_census_event requires supersededBy census pointer`;
    }
  });
  throw new Error(`Event disposition coverage failed:\n${lines.join("\n")}`);
}
