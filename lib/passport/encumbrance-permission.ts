/**
 * Sole derivation for passport `may(intent)` outcomes (E0 / E6 / S8-D1b / 9.3c / D2).
 * Available | blocked with named cause — source_unanswerable carries a known
 * address or named absence (`not_carried_by_vm`). Support causes are distinct
 * from chain-refused and from wait. Sell and bridge consume this; they do not
 * invent permission copy. Blocked gates always carry a non-empty sentence (§4.21).
 */

import { isAddress, getAddress, type Abi } from "viem";

import { AVAILABLE } from "@/lib/challenge/action-gate";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import type { SurfaceSupportCause } from "@/lib/passport/commerce-fact";
import type { KeyedEntry } from "@/lib/web3/keyed-multicall";
import { decodeCustomError } from "@/lib/web3/decode-custom-error";
import {
  mintProtocolOwner,
  type ProtocolOwner,
} from "@/lib/web3/protocol-address";
import { shortAddress } from "@/lib/web3/wallet-display";

/** Named absence: EVM carries an address; SVM Custom(20) does not. */
export type EncumbranceUnanswerableSource =
  | { readonly presence: "known"; readonly address: ProtocolOwner }
  | { readonly presence: "not_carried_by_vm" };

export type EncumbrancePermissionCause =
  | "refused"
  | "source_unanswerable"
  | "reads_unresolved"
  | "fee_payer_required"
  | "construction"
  | "simulation_unavailable"
  | "unmapped_program_error"
  | SurfaceSupportCause;

export type EncumbrancePermissionGate =
  | { readonly status: "available" }
  | {
      readonly status: "blocked";
      readonly cause:
        | "refused"
        | "reads_unresolved"
        | "fee_payer_required"
        | "construction"
        | "simulation_unavailable"
        | "unmapped_program_error"
        | SurfaceSupportCause;
    }
  | {
      readonly status: "blocked";
      readonly cause: "source_unanswerable";
      readonly source: EncumbranceUnanswerableSource;
    };

export type EncumbrancePermissionIntent = "openConsignment" | "leaveChain";

/** Closed list of blocked causes for exhaustive copy plants (excl. source arm). */
export const ENCUMBRANCE_PERMISSION_BLOCKED_CAUSES = [
  "refused",
  "reads_unresolved",
  "fee_payer_required",
  "construction",
  "simulation_unavailable",
  "unmapped_program_error",
  "not_in_program",
  "product_owner_owed",
  "authority_only",
] as const satisfies ReadonlyArray<
  Exclude<EncumbrancePermissionCause, "source_unanswerable">
>;

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
 *
 * `namespace` is required to mint a ProtocolOwner for SourceUnanswerable;
 * without it the refusal stays `reads_unresolved` (never invent an address).
 */
export function deriveEncumbrancePermission(
  entry: KeyedEntry | undefined,
  opts?: { namespace?: number },
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
          const hex = parseSourceArg(decoded.args);
          if (hex != null && opts?.namespace != null) {
            const address = mintProtocolOwner(opts.namespace, hex);
            if (address != null) {
              return {
                status: "blocked",
                cause: "source_unanswerable",
                source: { presence: "known", address },
              };
            }
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
 * when presence is known. Unresolved is waiting copy, never a definite refusal.
 * Every blocked cause returns a non-empty sentence (§4.21).
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
      return "This app does not read this on this network yet.";
    case "not_in_program":
      return "This network's passport program does not answer this permission.";
    case "authority_only":
      return "Only the program authority can do this on this network.";
    case "fee_payer_required":
      return "Connect a Solana wallet to check this permission on this network.";
    case "construction":
      return "The network rejected the permission check as invalid for this passport.";
    case "simulation_unavailable":
      return "The network did not answer whether this action is permitted.";
    case "unmapped_program_error":
      return "The passport program refused the check for a reason this app does not recognize yet.";
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
 * Named absence never invents an address.
 */
export function sourceUnanswerableCopy(
  source: EncumbranceUnanswerableSource,
): string {
  if (source.presence === "not_carried_by_vm") {
    return "A registered encumbrance source could not answer. This network does not name which one, so the registered sources must be reviewed before this action can proceed.";
  }
  const label = shortAddress(source.address);
  return `A registered encumbrance source (${label}) could not answer. Governance must remove or replace that source before this action can proceed.`;
}

/** Known-address extract for registry highlight; never invents. */
export function encumbranceUnanswerableKnownAddress(
  gate: EncumbrancePermissionGate,
): ProtocolOwner | null {
  if (gate.status !== "blocked" || gate.cause !== "source_unanswerable") {
    return null;
  }
  return gate.source.presence === "known" ? gate.source.address : null;
}
