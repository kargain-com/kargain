/**
 * Sole derivation for passport `may(intent)` outcomes (E0 / E6 / S8-D1b).
 * Available | blocked with named cause — address carried on source_unanswerable.
 * Support causes (surfaceSupport) are distinct from chain-refused and from wait.
 * Sell and bridge consume this; they do not invent permission copy.
 */

import { isAddress, getAddress, type Abi } from "viem";

import { AVAILABLE } from "@/lib/challenge/action-gate";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import type { SurfaceSupportCause } from "@/lib/passport/commerce-fact";
import type { KeyedEntry } from "@/lib/web3/keyed-multicall";
import { decodeCustomError } from "@/lib/web3/decode-custom-error";
import { shortAddress } from "@/lib/web3/wallet-display";

export type EncumbrancePermissionCause =
  | "refused"
  | "source_unanswerable"
  | "reads_unresolved"
  | SurfaceSupportCause;

export type EncumbrancePermissionGate =
  | { readonly status: "available" }
  | {
      readonly status: "blocked";
      readonly cause: "refused" | "reads_unresolved" | SurfaceSupportCause;
    }
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
 * Fail closed: pending and opaque refusals are `reads_unresolved`, never
 * presented as a definite permission refusal.
 */
export function deriveEncumbrancePermission(
  entry: KeyedEntry | undefined,
): EncumbrancePermissionGate {
  if (entry == null) {
    return { status: "blocked", cause: "reads_unresolved" };
  }
  switch (entry.status) {
    case "pending":
      return { status: "blocked", cause: "reads_unresolved" };
    case "success": {
      if (entry.result === true) return AVAILABLE;
      if (entry.result === false) {
        return { status: "blocked", cause: "refused" };
      }
      return { status: "blocked", cause: "reads_unresolved" };
    }
    case "refused": {
      if (entry.error != null) {
        const decoded = decodeCustomError(entry.error, ABI);
        if (decoded?.name === "SourceUnanswerable") {
          const source = parseSourceArg(decoded.args);
          if (source != null) {
            return { status: "blocked", cause: "source_unanswerable", source };
          }
        }
      }
      return { status: "blocked", cause: "reads_unresolved" };
    }
    default: {
      const _exhaustive: never = entry;
      return _exhaustive;
    }
  }
}

/** Gate from a surfaceSupport refusal — never mapped to reads_unresolved. */
export function encumbrancePermissionFromSupport(
  cause: SurfaceSupportCause,
): EncumbrancePermissionGate {
  return { status: "blocked", cause };
}

export function isEncumbrancePermissionAvailable(
  gate: EncumbrancePermissionGate,
): boolean {
  return gate.status === "available";
}

/**
 * Body copy for a blocked gate. Unanswerable names the source as a fact
 * (not an alarm). Unresolved is waiting copy, never a definite refusal.
 * Support causes return empty — D2 names them at the control; this unit
 * must not invent wait-as-refusal or a new D2 sentence.
 */
export function encumbrancePermissionCopy(
  gate: EncumbrancePermissionGate,
  intent: EncumbrancePermissionIntent,
): string {
  if (gate.status === "available") return "";

  const cause = gate.cause;
  switch (cause) {
    case "reads_unresolved":
      return "Waiting for chain permission…";
    case "source_unanswerable":
      return sourceUnanswerableCopy(gate.source);
    case "product_owner_owed":
    case "not_in_program":
    case "authority_only":
      return "";
    case "refused":
      if (intent === "openConsignment") {
        return "This passport cannot open a consignment right now.";
      }
      return "This passport cannot leave the chain right now.";
    default: {
      const _exhaustive: never = cause;
      return _exhaustive;
    }
  }
}

/**
 * Shared E6 refusal copy for preview and write-path mapper — one vocabulary.
 */
export function sourceUnanswerableCopy(source: `0x${string}`): string {
  const label = shortAddress(source);
  return `A registered encumbrance source (${label}) could not answer. Governance must remove or replace that source before this action can proceed.`;
}
