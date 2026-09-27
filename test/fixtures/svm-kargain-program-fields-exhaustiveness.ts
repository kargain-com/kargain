/**
 * Type-level plant: SVM_KARGAIN_PROGRAM_FIELDS must list every
 * SvmKargainProgramIds key. Incomplete table is intentionally under
 * a ts-expect-error so `pnpm typecheck` stays green while the expect-error
 * remains required. Policy suite strips the directive → tsc red.
 */
import type { SvmKargainProgramIds } from "@/lib/web3/commercial-active";

// @ts-expect-error — incomplete table must fail Record<keyof SvmKargainProgramIds, true>
export const INCOMPLETE_SVM_KARGAIN_PROGRAM_FIELDS: Record<
  keyof SvmKargainProgramIds,
  true
> = {
  karPassport: true,
  karProPass: true,
  karProStaking: true,
  bridgeGateway: true,
  // fixedPriceConsignment omitted
  ascendingConsignment: true,
};
