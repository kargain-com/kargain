/**
 * ABI-derived event name → decoded args for address-conditional Ponder
 * contracts (FixedPriceConsignment, AscendingConsignment,
 * KarPassportBridgeGateway). Same generated ABIs as commercial-abi-events.
 *
 * Registration lives in ponder-optional-contract-on.ts (sole ponder.on cast).
 */

import type {
  ContractEventArgsFromTopics,
  ContractEventName,
} from "viem";

import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
  KarPassportBridgeGatewayAbi,
} from "@/lib/contracts/abis.generated";

/** Runtime-enumerable ABI table — sole name→args source for optional contracts. */
export const OPTIONAL_CONTRACT_ABIS = {
  FixedPriceConsignment: FixedPriceConsignmentAbi,
  AscendingConsignment: AscendingConsignmentAbi,
  KarPassportBridgeGateway: KarPassportBridgeGatewayAbi,
} as const;

export type OptionalContractName = keyof typeof OPTIONAL_CONTRACT_ABIS;

export type OptionalContractEventName = {
  [C in OptionalContractName]: `${C}:${ContractEventName<(typeof OPTIONAL_CONTRACT_ABIS)[C]>}`;
}[OptionalContractName];

/**
 * Full decoded log args (not filter-style indexed-only ContractEventArgs).
 * `strict: true` → every ABI input is required, matching Ponder's decoded event.
 */
export type OptionalContractEventArgs<N extends OptionalContractEventName> =
  N extends `${infer C}:${infer E}`
    ? C extends OptionalContractName
      ? E extends ContractEventName<(typeof OPTIONAL_CONTRACT_ABIS)[C]>
        ? ContractEventArgsFromTopics<(typeof OPTIONAL_CONTRACT_ABIS)[C], E, true>
        : never
      : never
    : never;

/**
 * `contract:event` keys for every event on the three optional-contract ABIs.
 * Completeness vs commercial-abi-events is guarded by policy.
 */
export function listOptionalContractEventKeys(): string[] {
  const out: string[] = [];
  for (const contract of Object.keys(
    OPTIONAL_CONTRACT_ABIS,
  ) as OptionalContractName[]) {
    for (const item of OPTIONAL_CONTRACT_ABIS[contract]) {
      if (
        item &&
        typeof item === "object" &&
        "type" in item &&
        item.type === "event" &&
        "name" in item &&
        typeof item.name === "string"
      ) {
        out.push(`${contract}:${item.name}`);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}
