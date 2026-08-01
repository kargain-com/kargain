/**
 * Sole derivation for passport `may(intent)` outcomes (E0 / E6).
 * Available | blocked with named cause — address carried on source_unanswerable.
 * Sell and bridge consume this; they do not invent permission copy.
 */

import { isAddress, getAddress, type Abi } from "viem";

import { AVAILABLE } from "@/lib/challenge/action-gate";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import type { KeyedEntry } from "@/lib/web3/keyed-multicall";
import { decodeCustomError } from "@/lib/web3/decode-custom-error";
import { shortAddress } from "@/lib/web3/wallet-display";

export type EncumbrancePermissionCause =
  | "refused"
  | "source_unanswerable"
  | "reads_unresolved";

export type EncumbrancePermissionGate =
  | { readonly status: "available" }
  | { readonly status: "blocked"; readonly cause: "refused" | "reads_unresolved" }
  | {
      readonly status: "blocked";
      readonly cause: "source_unanswerable";
      readonly source: `0x${string}`;
    };

export type EncumbrancePermissionIntent = "openConsignment" | "leaveChain";

const ABI = KarPassportAbi as Abi;

function parseSourceArg(args: readonly unknown[] | undefined): `0x${string}` | null {
  const raw = args?.[0];
  if (typeof raw !== "string" || !isAddress(raw)) return null;
  return getAddress(raw);
}

/**
 * Derive the §9 permission gate from a keyed multicall `may` entry.
 * Fail closed: unread and opaque failures are `reads_unresolved`, never
 * presented as a definite refusal.
 */
export function deriveEncumbrancePermission(
  entry: KeyedEntry | undefined,
): EncumbrancePermissionGate {
  if (entry == null) {
    return { status: "blocked", cause: "reads_unresolved" };
  }
  if (entry.status === "success") {
    if (entry.result === true) return AVAILABLE;
    if (entry.result === false) {
      return { status: "blocked", cause: "refused" };
    }
    return { status: "blocked", cause: "reads_unresolved" };
  }

  const decoded = decodeCustomError(entry.error, ABI);
  if (decoded?.name === "SourceUnanswerable") {
    const source = parseSourceArg(decoded.args);
    if (source != null) {
      return { status: "blocked", cause: "source_unanswerable", source };
    }
  }
  return { status: "blocked", cause: "reads_unresolved" };
}

export function isEncumbrancePermissionAvailable(
  gate: EncumbrancePermissionGate,
): boolean {
  return gate.status === "available";
}

/**
 * Body copy for a blocked gate. Unanswerable names the source as a fact
 * (not an alarm). Unresolved is waiting copy, never a definite refusal.
 */
export function encumbrancePermissionCopy(
  gate: EncumbrancePermissionGate,
  intent: EncumbrancePermissionIntent,
): string {
  if (gate.status === "available") return "";

  if (gate.cause === "reads_unresolved") {
    return "Waiting for chain permission…";
  }

  if (gate.cause === "source_unanswerable") {
    return sourceUnanswerableCopy(gate.source);
  }

  // refused
  if (intent === "openConsignment") {
    return "This passport cannot open a consignment right now.";
  }
  return "This passport cannot leave the chain right now.";
}

/**
 * Shared E6 refusal copy for preview and write-path mapper — one vocabulary.
 */
export function sourceUnanswerableCopy(source: `0x${string}`): string {
  const label = shortAddress(source);
  return `A registered encumbrance source (${label}) could not answer. Governance must remove or replace that source before this action can proceed.`;
}
