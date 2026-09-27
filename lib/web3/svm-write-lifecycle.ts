import { toHex } from "viem";

import {
  decodeEventPayloadBody,
  fieldBytes32,
  fieldPubkey32,
  tokenIdFromBytes32,
} from "@/lib/svm/event-payload-decode";
import type { StructuredPayloadDraft } from "@/lib/svm/parse-transaction-ingest";
import {
  commercialActive,
  type CommercialRegistry,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import { encodeSvmPubkeyBytes } from "@/lib/web3/protocol-address";
import {
  fetchSvmTransactionStructuredPayloads,
  createProductSvmTxConfirmPort,
} from "@/lib/web3/svm-rpc";
import {
  confirmSvmTransaction,
  SvmConfirmRefusal,
  type SvmTxConfirmPort,
} from "@/lib/web3/svm-tx-confirm";
import {
  buildWriteOutcome,
  isSvmWriteSubmission,
  type BridgeSendGuidWriteFact,
  type PassportMintedWriteFact,
  type WriteOutcome,
  type WriteSubmission,
} from "@/lib/web3/write-outcome";

type SvmWriteLifecyclePhase = "wallet" | "confirming" | "indexing";

type SvmLifecycleFacts = {
  claimRecipients: readonly string[];
  mintedPassportTokenId: PassportMintedWriteFact;
  bridgeSendGuid: BridgeSendGuidWriteFact;
};

export type FetchSvmStructuredPayloads = (args: {
  stack: SvmCommercialActiveStack;
  signature: string;
  slotHint?: bigint;
}) => Promise<StructuredPayloadDraft[]>;

type RunSvmWriteLifecycleOptions = {
  chainId: number;
  writeFn: () => Promise<WriteSubmission>;
  onPhase?: (phase: SvmWriteLifecyclePhase) => void;
  registry?: CommercialRegistry;
  createConfirmPort?: (stack: SvmCommercialActiveStack) => SvmTxConfirmPort;
  fetchStructuredPayloads?: FetchSvmStructuredPayloads;
};

function asSvmStack(
  chainId: number,
  registry?: CommercialRegistry,
): SvmCommercialActiveStack {
  const stack = commercialActive(chainId, registry);
  if (!stack || stack.vm !== "svm") {
    throw new Error(`SVM write lifecycle requires an SVM stack for namespace ${chainId}.`);
  }
  return stack;
}

function deriveSvmWriteFacts(
  payloads: readonly StructuredPayloadDraft[],
): SvmLifecycleFacts {
  const claimRecipients = new Set<string>();
  let mintedPassportTokenId: PassportMintedWriteFact = {
    ok: false,
    cause: "missing_minted_passport",
  };
  let bridgeSendGuid: BridgeSendGuidWriteFact = {
    ok: false,
    cause: "missing_bridge_send_guid",
  };

  for (const payload of payloads) {
    let decoded;
    try {
      decoded = decodeEventPayloadBody({
        contractName: payload.contractName,
        eventName: payload.eventName,
        payloadBytes: payload.payloadBytes,
      });
    } catch {
      continue;
    }

    if (
      payload.contractName === "KarPassport" &&
      payload.eventName === "PassportMinted" &&
      !mintedPassportTokenId.ok
    ) {
      mintedPassportTokenId = {
        ok: true,
        tokenId: tokenIdFromBytes32(fieldBytes32(decoded.fields, "tokenId")),
      };
      continue;
    }

    if (
      payload.contractName === "KarPassportBridgeGateway" &&
      payload.eventName === "ONFTSent" &&
      !bridgeSendGuid.ok
    ) {
      bridgeSendGuid = {
        ok: true,
        guid: toHex(fieldBytes32(decoded.fields, "guid")),
      };
      continue;
    }

    if (payload.eventName === "ClaimRecorded") {
      claimRecipients.add(
        encodeSvmClaimRecipient(decoded.fields),
      );
    }
  }

  return {
    claimRecipients: [...claimRecipients],
    mintedPassportTokenId,
    bridgeSendGuid,
  };
}

function encodeSvmClaimRecipient(
  fields: ReturnType<typeof decodeEventPayloadBody>["fields"],
): string {
  return encodeSvmPubkeyBytes(fieldPubkey32(fields, "account"));
}

export async function runSvmWriteLifecycle({
  chainId,
  writeFn,
  onPhase,
  registry,
  createConfirmPort = createProductSvmTxConfirmPort,
  fetchStructuredPayloads = fetchSvmTransactionStructuredPayloads,
}: RunSvmWriteLifecycleOptions): Promise<WriteOutcome> {
  const stack = asSvmStack(chainId, registry);

  onPhase?.("wallet");
  const submission = await writeFn();
  if (!isSvmWriteSubmission(submission)) {
    throw new Error("SVM write lifecycle received an EVM transaction hash.");
  }

  onPhase?.("confirming");
  const confirmation = await confirmSvmTransaction(
    createConfirmPort(stack),
    submission,
  );
  if (confirmation.kind !== "landed_ok") {
    throw new SvmConfirmRefusal(confirmation);
  }

  onPhase?.("indexing");
  const payloads = await fetchStructuredPayloads({
    stack,
    signature: submission.signature,
    slotHint: confirmation.slot,
  });
  const facts = deriveSvmWriteFacts(payloads);

  return buildWriteOutcome({
    writeReference: submission.signature,
    indexerBarrier: {
      status: "unavailable",
      cause: "svm_ingest_unavailable",
    },
    claimRecipients: facts.claimRecipients,
    mintedPassportTokenId: facts.mintedPassportTokenId,
    bridgeSendGuid: facts.bridgeSendGuid,
  });
}
