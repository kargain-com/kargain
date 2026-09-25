/**
 * Sole dual-VM owner for FixedPrice OpenDirect.
 *
 * Panels call through {@link executeOpenFixedPriceConsignment} (via
 * `useOpenFixedPriceConsignment`) and pass the result through `runTx`.
 * Sell-surface / encumbrance permission stay in their owners — this module
 * never re-decides who may open.
 *
 * VM fork lives here only (not in app/components/hooks). SVM this unit:
 * native Asset denomination only; OpenFromMandate / fiat / SPL out of unit.
 * Settlement note is EVM-only in listing-edit — not an arm of this owner.
 */

import { FixedPriceConsignmentAbi } from "@/lib/contracts/abis.generated";
import {
  DENOMINATION_KIND,
  ZERO_CURRENCY_CODE,
  type DenominationKind,
} from "@/lib/commerce/denomination";
import {
  ENCUMBRANCE_INTENT,
  isZeroAddress,
} from "@/lib/commerce/consignment";
import {
  commerceModeEvmAddress,
  resolveCommerceMode,
} from "@/lib/commerce/mode";
import {
  decodePassportConfig,
  type EncumbranceSourceDecoded,
} from "@/lib/svm/decode-account-state";
import { encodeSvmInstruction } from "@/lib/svm/encode-instruction";
import {
  deriveSvmPda,
  type DeriveSvmPdaResult,
  type PdaSeedValue,
} from "@/lib/svm/derive-pda";
import { tokenIdToBytes32 } from "@/lib/svm/event-payload-decode";
import {
  mplCoreProgramId,
  systemProgramId,
} from "@/lib/svm/foreign-programs";
import {
  type ActiveAccount,
  type WalletFamilyWanted,
} from "@/lib/web3/active-account";
import {
  commercialActive,
  type CommercialRegistry,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import {
  fetchProductSvmAccountData,
  type FetchSvmAccountDataResult,
} from "@/lib/web3/svm-rpc";
import {
  AccountRole,
  sendSvmInstruction,
  type SvmSignAndSendPort,
  type SvmWriteAccountMeta,
} from "@/lib/web3/svm-write-adapter";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import {
  txWriteAvailabilityForCapability,
  txWriteRefusalMessage,
} from "@/lib/web3/tx-write-availability";

const ZERO32 = new Uint8Array(32);
const U64_MAX = (1n << 64n) - 1n;

/** EVM call shape — behavioural pin: openDirect + four args. */
export type OpenFixedPriceConsignmentEvmCall = {
  address: `0x${string}`;
  abi: typeof FixedPriceConsignmentAbi;
  functionName: "openDirect";
  args: [
    bigint,
    { kind: DenominationKind; currencyCode: `0x${string}` },
    `0x${string}`,
    bigint,
  ];
  chainId: number;
};

export type OpenFixedPriceConsignmentSvmPlan = {
  programId: string;
  data: Uint8Array;
  accounts: readonly SvmWriteAccountMeta[];
  feePayer: string;
};

export type OpenFixedPriceConsignmentCause =
  | "disconnected"
  | "wrong_vm"
  | "unresolved_namespace"
  | "not_in_program"
  | "product_owner_owed"
  | "authority_only"
  | "mode_not_configured"
  | "invalid_token_id"
  | "invalid_price"
  | "fiat_not_supported"
  | "settlement_not_native"
  | "encumbrance_seed_required"
  | "config_unavailable"
  | "config_decode_failed"
  | "encode_failed"
  | "pda_failed"
  | "wallet_cannot_sign_and_send"
  | "no_connected_account"
  | "send_failed";

export type PlanOpenFixedPriceConsignmentResult =
  | { ok: true; vm: "evm"; call: OpenFixedPriceConsignmentEvmCall }
  | { ok: true; vm: "svm"; plan: OpenFixedPriceConsignmentSvmPlan }
  | {
      ok: false;
      cause: OpenFixedPriceConsignmentCause;
      detail: string;
      wanted?: WalletFamilyWanted;
    };

export type WriteEvmContractFn = (
  args: OpenFixedPriceConsignmentEvmCall,
) => Promise<`0x${string}`>;

/** Injectable account-data fetch for PassportConfig seed (tests / stand). */
export type FetchSvmAccountDataFn = (
  account: string,
) => Promise<FetchSvmAccountDataResult>;

/**
 * Inject PDA derive for local-validator program ids (stand).
 * Default: {@link deriveSvmPda} (commercial registry only).
 */
export type OpenFixedPriceDerivePda = (input: {
  recipe: string;
  programId: string;
  seeds?: Record<string, PdaSeedValue>;
}) => Promise<DeriveSvmPdaResult>;

/**
 * Seed prefix for a mode program from PassportConfig encumbrance sources.
 * Null when the mode is not registered — never invent.
 */
export function encumbranceSeedPrefixForMode(
  sources: readonly EncumbranceSourceDecoded[],
  modeProgramId: string,
): Uint8Array | null {
  const hit = sources.find((s) => s.programId === modeProgramId);
  if (hit == null || hit.seedPrefixBytes.length === 0) return null;
  return Uint8Array.from(hit.seedPrefixBytes);
}

/**
 * Build the EVM write args. Sole construction site for the behavioural pin.
 * Do not invent a second functionName here.
 */
export function buildEvmOpenFixedPriceConsignmentCall(args: {
  address: `0x${string}`;
  tokenId: string;
  denominationKind: DenominationKind;
  currencyCode: `0x${string}`;
  settlementAsset: `0x${string}`;
  price: bigint;
  chainId: number;
}): OpenFixedPriceConsignmentEvmCall {
  return {
    address: args.address,
    abi: FixedPriceConsignmentAbi,
    functionName: "openDirect",
    args: [
      BigInt(args.tokenId),
      { kind: args.denominationKind, currencyCode: args.currencyCode },
      args.settlementAsset,
      args.price,
    ],
    chainId: wagmiChainId(args.chainId),
  };
}

/**
 * Assemble OpenDirect metas in processor / stand order:
 * seller, config, binding, passportConfig, asset, challenge, mayAnswerOpen,
 * consign, custody, system, payer, core, answerLeave, answerOpen.
 * Native path only (no paymentTok). mayAnswerOpen and answerOpen are the same
 * OpenConsignment answer PDA (readonly mid-list, writable at end).
 */
export function assembleOpenFixedPriceConsignmentAccounts(args: {
  seller: string;
  config: string;
  binding: string;
  passportConfig: string;
  asset: string;
  challenge: string;
  mayAnswerOpen: string;
  consign: string;
  custody: string;
  system: string;
  payer: string;
  core: string;
  answerLeave: string;
  answerOpen: string;
}): SvmWriteAccountMeta[] {
  return [
    { address: args.seller, role: AccountRole.READONLY_SIGNER },
    { address: args.config, role: AccountRole.READONLY },
    { address: args.binding, role: AccountRole.READONLY },
    { address: args.passportConfig, role: AccountRole.READONLY },
    { address: args.asset, role: AccountRole.WRITABLE },
    { address: args.challenge, role: AccountRole.READONLY },
    { address: args.mayAnswerOpen, role: AccountRole.READONLY },
    { address: args.consign, role: AccountRole.WRITABLE },
    { address: args.custody, role: AccountRole.READONLY },
    { address: args.system, role: AccountRole.READONLY },
    { address: args.payer, role: AccountRole.WRITABLE_SIGNER },
    { address: args.core, role: AccountRole.READONLY },
    { address: args.answerLeave, role: AccountRole.WRITABLE },
    { address: args.answerOpen, role: AccountRole.WRITABLE },
  ];
}

export async function planOpenFixedPriceConsignment(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  denominationKind: DenominationKind;
  currencyCode: `0x${string}`;
  settlementAsset: `0x${string}`;
  price: bigint;
  registry?: CommercialRegistry;
  /** Optional inject — when omitted, SVM arm loads PassportConfig. */
  encumbranceSeedPrefix?: Uint8Array;
  fetchAccountData?: FetchSvmAccountDataFn;
  /**
   * Stand inject — local FixedPrice/passport ids are not in COMMERCIAL_ACTIVE.
   * Product path keeps the commercial registry gate.
   */
  derivePda?: OpenFixedPriceDerivePda;
}): Promise<PlanOpenFixedPriceConsignmentResult> {
  const avail = txWriteAvailabilityForCapability(
    input.account,
    "fixed_price_open_direct",
    input.chainId,
    input.registry,
  );
  if (!avail.available) {
    return {
      ok: false,
      cause: avail.cause,
      detail: txWriteRefusalMessage(avail),
      ...(avail.cause === "wrong_vm" ? { wanted: avail.wanted } : {}),
    };
  }

  if (input.price <= 0n || input.price > U64_MAX) {
    return {
      ok: false,
      cause: "invalid_price",
      detail: "price must be a positive u64",
    };
  }

  const stack = commercialActive(input.chainId, input.registry);
  if (stack == null) {
    return {
      ok: false,
      cause: "unresolved_namespace",
      detail: "commercial stack missing after availability admit",
    };
  }

  const mode = resolveCommerceMode(
    "fixedPrice",
    input.chainId,
    input.registry,
  );
  if (mode.status !== "configured") {
    return {
      ok: false,
      cause: "mode_not_configured",
      detail: mode.cause,
    };
  }

  if (avail.vm === "evm") {
    if (stack.vm !== "evm") {
      return {
        ok: false,
        cause: "wrong_vm",
        detail: "availability/stack vm mismatch",
        wanted: stack.vm,
      };
    }
    const address = commerceModeEvmAddress(
      "fixedPrice",
      input.chainId,
      input.registry,
    );
    if (address == null) {
      return {
        ok: false,
        cause: "mode_not_configured",
        detail: `no FixedPrice hex for chain ${input.chainId}`,
      };
    }
    try {
      const call = buildEvmOpenFixedPriceConsignmentCall({
        address,
        tokenId: input.tokenId,
        denominationKind: input.denominationKind,
        currencyCode: input.currencyCode,
        settlementAsset: input.settlementAsset,
        price: input.price,
        chainId: input.chainId,
      });
      return { ok: true, vm: "evm", call };
    } catch (err) {
      return {
        ok: false,
        cause: "invalid_token_id",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (stack.vm !== "svm") {
    return {
      ok: false,
      cause: "wrong_vm",
      detail: "availability/stack vm mismatch",
      wanted: stack.vm,
    };
  }

  return planSvmOpenFixedPriceConsignment({
    stack,
    account: input.account,
    tokenId: input.tokenId,
    denominationKind: input.denominationKind,
    currencyCode: input.currencyCode,
    settlementAsset: input.settlementAsset,
    price: input.price,
    modeProgramId: mode.address,
    encumbranceSeedPrefix: input.encumbranceSeedPrefix,
    fetchAccountData: input.fetchAccountData ?? fetchProductSvmAccountData,
    derivePda: input.derivePda ?? deriveSvmPda,
  });
}

async function planSvmOpenFixedPriceConsignment(args: {
  stack: SvmCommercialActiveStack;
  account: ActiveAccount;
  tokenId: string;
  denominationKind: DenominationKind;
  currencyCode: `0x${string}`;
  settlementAsset: `0x${string}`;
  price: bigint;
  modeProgramId: string;
  encumbranceSeedPrefix?: Uint8Array;
  fetchAccountData: FetchSvmAccountDataFn;
  derivePda: OpenFixedPriceDerivePda;
}): Promise<PlanOpenFixedPriceConsignmentResult> {
  if (args.account.status !== "connected" || args.account.vm !== "svm") {
    return {
      ok: false,
      cause: "wrong_vm",
      detail: "SVM plan requires connected SVM session",
      wanted: "svm",
    };
  }

  if (args.denominationKind !== DENOMINATION_KIND.Asset) {
    return {
      ok: false,
      cause: "fiat_not_supported",
      detail: "SVM FixedPrice open is native Asset denomination only this unit",
    };
  }

  if (!isZeroAddress(args.settlementAsset)) {
    return {
      ok: false,
      cause: "settlement_not_native",
      detail: "SVM FixedPrice open is native settlement only this unit",
    };
  }

  if (
    args.currencyCode.toLowerCase() !== ZERO_CURRENCY_CODE.toLowerCase()
  ) {
    return {
      ok: false,
      cause: "fiat_not_supported",
      detail: "SVM FixedPrice open refuses non-zero currency code",
    };
  }

  let tokenBytes: Uint8Array;
  try {
    tokenBytes = tokenIdToBytes32(args.tokenId);
  } catch (err) {
    return {
      ok: false,
      cause: "invalid_token_id",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  let seedPrefixBytes: Uint8Array | null =
    args.encumbranceSeedPrefix != null && args.encumbranceSeedPrefix.length > 0
      ? new Uint8Array(args.encumbranceSeedPrefix)
      : null;
  if (seedPrefixBytes == null) {
    const loaded = await loadEncumbranceSeedPrefix({
      stack: args.stack,
      modeProgramId: args.modeProgramId,
      fetchAccountData: args.fetchAccountData,
      derivePda: args.derivePda,
    });
    if (!loaded.ok) return loaded;
    seedPrefixBytes = new Uint8Array(loaded.seedPrefix);
  }
  const seedPrefix = seedPrefixBytes;

  const encoded = encodeSvmInstruction({
    program: "kar-fixed-price",
    variant: "OpenDirect",
    fields: {
      token_id: tokenBytes,
      asset_mint: ZERO32,
      denom_kind: DENOMINATION_KIND.Asset,
      currency_code: ZERO32,
      price: args.price,
    },
  });
  if (!encoded.ok) {
    return {
      ok: false,
      cause: "encode_failed",
      detail: `${encoded.cause}:${encoded.detail}`,
    };
  }

  const fpProgramId = args.modeProgramId;
  const passportProgramId = args.stack.karPassport;
  const seller = args.account.address;

  const derive = args.derivePda;
  const [
    configPda,
    bindingPda,
    consignPda,
    custodyPda,
    passportConfigPda,
    assetPda,
    challengePda,
    answerLeavePda,
    answerOpenPda,
  ] = await Promise.all([
    derive({
      recipe: "kargain-consignment-base/config",
      programId: fpProgramId,
    }),
    derive({
      recipe: "kargain-consignment-base/passport_binding",
      programId: fpProgramId,
    }),
    derive({
      recipe: "kargain-consignment-base/consignment",
      programId: fpProgramId,
      seeds: { token_id: tokenBytes },
    }),
    derive({
      recipe: "kargain-consignment-base/custody_authority",
      programId: fpProgramId,
    }),
    derive({
      recipe: "kar-passport/config",
      programId: passportProgramId,
    }),
    derive({
      recipe: "kar-passport/asset",
      programId: passportProgramId,
      seeds: { token_id: tokenBytes },
    }),
    derive({
      recipe: "kargain-bonded-challenge/challenge",
      programId: passportProgramId,
      seeds: { subject_id: tokenBytes },
    }),
    derive({
      recipe: "kargain-encumbrance/answer",
      programId: fpProgramId,
      seeds: {
        seed_prefix: seedPrefix,
        token_id: tokenBytes,
        intent: ENCUMBRANCE_INTENT.LeaveChain,
      },
    }),
    derive({
      recipe: "kargain-encumbrance/answer",
      programId: fpProgramId,
      seeds: {
        seed_prefix: seedPrefix,
        token_id: tokenBytes,
        intent: ENCUMBRANCE_INTENT.OpenConsignment,
      },
    }),
  ]);

  for (const pda of [
    configPda,
    bindingPda,
    consignPda,
    custodyPda,
    passportConfigPda,
    assetPda,
    challengePda,
    answerLeavePda,
    answerOpenPda,
  ]) {
    if (!pda.ok) {
      return {
        ok: false,
        cause: "pda_failed",
        detail: `${pda.cause}:${pda.detail}`,
      };
    }
  }
  if (
    !configPda.ok ||
    !bindingPda.ok ||
    !consignPda.ok ||
    !custodyPda.ok ||
    !passportConfigPda.ok ||
    !assetPda.ok ||
    !challengePda.ok ||
    !answerLeavePda.ok ||
    !answerOpenPda.ok
  ) {
    return { ok: false, cause: "pda_failed", detail: "unreachable" };
  }

  const accounts = assembleOpenFixedPriceConsignmentAccounts({
    seller,
    config: configPda.address,
    binding: bindingPda.address,
    passportConfig: passportConfigPda.address,
    asset: assetPda.address,
    challenge: challengePda.address,
    mayAnswerOpen: answerOpenPda.address,
    consign: consignPda.address,
    custody: custodyPda.address,
    system: systemProgramId(),
    payer: seller,
    core: mplCoreProgramId(),
    answerLeave: answerLeavePda.address,
    answerOpen: answerOpenPda.address,
  });

  return {
    ok: true,
    vm: "svm",
    plan: {
      programId: fpProgramId,
      data: encoded.data,
      accounts,
      feePayer: seller,
    },
  };
}

async function loadEncumbranceSeedPrefix(args: {
  stack: SvmCommercialActiveStack;
  modeProgramId: string;
  fetchAccountData: FetchSvmAccountDataFn;
  derivePda: OpenFixedPriceDerivePda;
}): Promise<
  | { ok: true; seedPrefix: Uint8Array }
  | {
      ok: false;
      cause: OpenFixedPriceConsignmentCause;
      detail: string;
    }
> {
  const configPda = await args.derivePda({
    recipe: "kar-passport/config",
    programId: args.stack.karPassport,
  });
  if (!configPda.ok) {
    return {
      ok: false,
      cause: "pda_failed",
      detail: `${configPda.cause}:${configPda.detail}`,
    };
  }
  const fetched = await args.fetchAccountData(configPda.address);
  if (!fetched.ok) {
    return {
      ok: false,
      cause: "config_unavailable",
      detail: `${fetched.cause}:${fetched.detail}`,
    };
  }
  const decoded = decodePassportConfig(fetched.value);
  if (!decoded.ok) {
    return {
      ok: false,
      cause: "config_decode_failed",
      detail: `${decoded.cause}:${decoded.detail}`,
    };
  }
  const seedPrefix = encumbranceSeedPrefixForMode(
    decoded.value.encumbranceSources,
    args.modeProgramId,
  );
  if (seedPrefix == null) {
    return {
      ok: false,
      cause: "encumbrance_seed_required",
      detail: `FixedPrice ${args.modeProgramId} not in PassportConfig sources`,
    };
  }
  return { ok: true, seedPrefix };
}

export async function executeOpenFixedPriceConsignment(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  denominationKind: DenominationKind;
  currencyCode: `0x${string}`;
  settlementAsset: `0x${string}`;
  price: bigint;
  writeEvmContract: WriteEvmContractFn;
  registry?: CommercialRegistry;
  encumbranceSeedPrefix?: Uint8Array;
  fetchAccountData?: FetchSvmAccountDataFn;
  svmPort?: SvmSignAndSendPort;
  fetchBlockhash?: Parameters<typeof sendSvmInstruction>[0]["fetchBlockhash"];
}): Promise<string> {
  const planned = await planOpenFixedPriceConsignment({
    account: input.account,
    chainId: input.chainId,
    tokenId: input.tokenId,
    denominationKind: input.denominationKind,
    currencyCode: input.currencyCode,
    settlementAsset: input.settlementAsset,
    price: input.price,
    registry: input.registry,
    encumbranceSeedPrefix: input.encumbranceSeedPrefix,
    fetchAccountData: input.fetchAccountData,
  });
  if (!planned.ok) {
    throw new Error(
      planned.detail.length > 0
        ? planned.detail
        : `openFixedPriceConsignment refused: ${planned.cause}`,
    );
  }

  if (planned.vm === "evm") {
    return input.writeEvmContract(planned.call);
  }

  if (input.svmPort == null) {
    throw new Error("openFixedPriceConsignment refused: no_connected_account");
  }

  const stack = commercialActive(input.chainId, input.registry);
  if (stack == null || stack.vm !== "svm") {
    throw new Error("openFixedPriceConsignment refused: unresolved_namespace");
  }

  const sent = await sendSvmInstruction({
    stack,
    programId: planned.plan.programId,
    data: planned.plan.data,
    accounts: planned.plan.accounts,
    feePayer: planned.plan.feePayer,
    port: input.svmPort,
    fetchBlockhash: input.fetchBlockhash,
  });
  if (!sent.ok) {
    throw new Error(
      `openFixedPriceConsignment refused: ${sent.cause}:${sent.detail}`,
    );
  }
  return sent.signature;
}
