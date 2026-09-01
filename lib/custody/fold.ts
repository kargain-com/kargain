/**
 * Pure two-stream custody fold (S7c-3). No VM/table names; no cross-writer timestamp order.
 */

import { originNamespaceOf } from "./origin.js";
import {
  type CustodyDeterminationKind,
  type CustodyFoldResult,
  type CustodyUnresolvedCause,
  type NormalizedCrossingLeg,
  type NormalizedCustodyEvent,
} from "./normalized-event.js";
import {
  compareWriterOrderKeys,
  writerIdFromOrderKey,
} from "./writer-order.js";

export type CustodyFoldInput = {
  tokenId: string;
  streamB: readonly NormalizedCustodyEvent[];
  crossings: readonly NormalizedCrossingLeg[];
  /** When set, namespaces must pass or fold returns unknown_namespace. */
  isRegisteredNamespace?: (namespace: number) => boolean;
};

type StepKind = CustodyDeterminationKind | "crossing_arrival" | "crossing_departure";

type FoldStep = {
  id: string;
  writerOrderKey: string;
  kind: StepKind;
  namespace: number;
};

function namespaceAllowed(
  namespace: number,
  isRegistered?: (ns: number) => boolean,
): boolean {
  if (isRegistered == null) return true;
  return isRegistered(namespace);
}

function buildGuidGroups(
  crossings: readonly NormalizedCrossingLeg[],
): Map<
  string,
  { sent: NormalizedCrossingLeg[]; received: NormalizedCrossingLeg[] }
> {
  const groups = new Map<
    string,
    { sent: NormalizedCrossingLeg[]; received: NormalizedCrossingLeg[] }
  >();
  for (const leg of crossings) {
    let group = groups.get(leg.guid);
    if (!group) {
      group = { sent: [], received: [] };
      groups.set(leg.guid, group);
    }
    if (leg.direction === "sent") group.sent.push(leg);
    else group.received.push(leg);
  }
  return groups;
}

function checkCrossingIntegrity(
  groups: Map<string, { sent: NormalizedCrossingLeg[]; received: NormalizedCrossingLeg[] }>,
): CustodyUnresolvedCause | null {
  for (const [, group] of groups) {
    if (group.received.length > 0 && group.sent.length === 0) {
      return "incomplete_crossing_link";
    }
    if (group.sent.length > 1 || group.received.length > 1) {
      return "incomplete_crossing_link";
    }
    if (group.sent.length === 1 && group.received.length === 0) {
      return "departure_without_arrival";
    }
  }
  return null;
}

function checkUnknownNamespace(input: CustodyFoldInput): CustodyUnresolvedCause | null {
  const reg = input.isRegisteredNamespace;
  if (!reg) return null;
  for (const ev of input.streamB) {
    if (!namespaceAllowed(ev.namespace, reg)) return "unknown_namespace";
  }
  for (const leg of input.crossings) {
    if (!namespaceAllowed(leg.observerNamespace, reg)) return "unknown_namespace";
    if (leg.peerNamespaceRefusal === "unknown_endpoint_id") return "unknown_namespace";
    if (leg.peerNamespace != null && !namespaceAllowed(leg.peerNamespace, reg)) {
      return "unknown_namespace";
    }
  }
  return null;
}

function applyStep(
  tokenId: string,
  kind: StepKind,
  namespace: number,
): number | null {
  switch (kind) {
    case "crossing_departure":
      return null;
    case "native_mint":
    case "home_unlock":
      return originNamespaceOf(tokenId);
    case "bridge_arrival":
    case "custody_unlock":
    case "crossing_arrival":
      return namespace;
  }
}

function topologicalApply(
  tokenId: string,
  steps: FoldStep[],
  guidEdges: Array<{ sentId: string; receivedId: string }>,
): CustodyFoldResult {
  const index = new Map<string, number>();
  steps.forEach((s, i) => index.set(s.id, i));
  const inDegree = new Array(steps.length).fill(0);
  const adj: number[][] = steps.map(() => []);

  const byWriter = new Map<string, FoldStep[]>();
  for (const step of steps) {
    const wid = writerIdFromOrderKey(step.writerOrderKey);
    const list = byWriter.get(wid) ?? [];
    list.push(step);
    byWriter.set(wid, list);
  }
  for (const list of byWriter.values()) {
    list.sort((a, b) => compareWriterOrderKeys(a.writerOrderKey, b.writerOrderKey));
    for (let i = 1; i < list.length; i += 1) {
      const from = index.get(list[i - 1]!.id)!;
      const to = index.get(list[i]!.id)!;
      adj[from]!.push(to);
      inDegree[to]! += 1;
    }
  }

  for (const edge of guidEdges) {
    const from = index.get(edge.sentId);
    const to = index.get(edge.receivedId);
    if (from == null || to == null) continue;
    adj[from]!.push(to);
    inDegree[to]! += 1;
  }

  const queue: number[] = [];
  inDegree.forEach((d, i) => {
    if (d === 0) queue.push(i);
  });

  const order: number[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    order.push(n);
    for (const m of adj[n]!) {
      inDegree[m]! -= 1;
      if (inDegree[m] === 0) {
        queue.push(m);
      }
    }
  }

  if (order.length !== steps.length) {
    return { status: "unresolved", cause: "conflicting_determination" };
  }

  let custody: number | null = null;
  for (const i of order) {
    const step = steps[i]!;
    const next = applyStep(tokenId, step.kind, step.namespace);
    if (next != null) custody = next;
  }

  if (custody == null) {
    return { status: "unresolved", cause: "empty_history" };
  }

  return { status: "resolved", custodyNamespace: custody };
}

/** Sole custody fold owner — VM-agnostic. */
export function foldPassportCustody(input: CustodyFoldInput): CustodyFoldResult {
  const unknown = checkUnknownNamespace(input);
  if (unknown) return { status: "unresolved", cause: unknown };

  if (input.streamB.length === 0 && input.crossings.length === 0) {
    return { status: "unresolved", cause: "empty_history" };
  }

  const groups = buildGuidGroups(input.crossings);
  const crossingIntegrity = checkCrossingIntegrity(groups);
  if (crossingIntegrity) {
    return { status: "unresolved", cause: crossingIntegrity };
  }

  const steps: FoldStep[] = input.streamB.map((ev, idx) => ({
    id: `b-${idx}`,
    writerOrderKey: ev.writerOrderKey,
    kind: ev.kind,
    namespace: ev.namespace,
  }));

  const guidEdges: Array<{ sentId: string; receivedId: string }> = [];
  for (const [guid, group] of groups) {
    if (group.sent.length === 1 && group.received.length === 1) {
      const sent = group.sent[0]!;
      const received = group.received[0]!;
      const sentId = `x-${guid}-sent`;
      const receivedId = `x-${guid}-received`;
      steps.push({
        id: sentId,
        writerOrderKey: sent.writerOrderKey,
        kind: "crossing_departure",
        namespace: sent.observerNamespace,
      });
      steps.push({
        id: receivedId,
        writerOrderKey: received.writerOrderKey,
        kind: "crossing_arrival",
        namespace: received.observerNamespace,
      });
      guidEdges.push({ sentId, receivedId });

      // Stream B on arrival chain at/after the received leg follows the crossing.
      for (let i = 0; i < input.streamB.length; i += 1) {
        const ev = input.streamB[i]!;
        if (ev.namespace !== received.observerNamespace) continue;
        if (
          writerIdFromOrderKey(ev.writerOrderKey) !==
          writerIdFromOrderKey(received.writerOrderKey)
        ) {
          continue;
        }
        if (compareWriterOrderKeys(ev.writerOrderKey, received.writerOrderKey) <= 0) {
          continue;
        }
        guidEdges.push({ sentId: receivedId, receivedId: `b-${i}` });
      }
    }
  }

  if (steps.length === 0) {
    return { status: "unresolved", cause: "empty_history" };
  }

  return topologicalApply(input.tokenId, steps, guidEdges);
}
