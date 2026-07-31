"use client";

import { useCallback, useRef, useState } from "react";
import {
  getAddress,
  type Address,
  type Hex,
} from "viem";
import {
  useAccount,
  usePublicClient,
  useWriteContract,
} from "wagmi";

import { usePassportApproval } from "@/hooks/use-passport-approval";
import { useTxSync } from "@/hooks/use-tx-sync";
import {
  KarPassportAbi,
  KarPassportBridgeGatewayAbi,
} from "@/lib/contracts/abis.generated";
import {
  formatPassportBridgeBlockedMessage,
  txErrorMessage,
} from "@/lib/marketplace/tx-error-message";
import {
  deriveBridgeDirectionMode,
  type BridgeDirectionMode,
} from "@/lib/passport/bridge-surface";
import { upsertBridgeTransit } from "@/lib/passport/bridge-transit-store";
import { parsePassportTokenId } from "@/lib/passport/passport-token-id";
import {
  BRIDGE_DELIVERY_POLL_MS,
  BRIDGE_DELIVERY_TIMEOUT_MS,
  BRIDGE_HUB_CHAIN_ID,
  BRIDGE_SPOKE_CHAIN_ID,
  BridgeUriTooLongError,
  bridgeAdapterAddress,
  bridgeCounterpartChainId,
  bridgeDstEid,
  bridgeTokenAddress,
  buildSendParam,
  getBridgeReadClient,
  layerZeroScanTxUrl,
  onftSentGuidFromLogs,
  quoteMessagingFee,
  sendArgs,
  type BridgeSendParam,
} from "@/lib/web3/bridge";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { shortChainName, wagmiChainId } from "@/lib/web3/supported-chains";

export type BridgePhase =
  | "idle"
  | "quoting"
  | "approving"
  | "sending"
  | "pending"
  | "delivered"
  | "error";

function mapBridgeError(err: unknown): string {
  if (err instanceof BridgeUriTooLongError) {
    return err.message;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("LeaveChainRefused")) {
    return "This passport cannot leave the chain right now (encumbrance refused).";
  }
  if (msg.includes("PassportDisputed")) {
    return formatPassportBridgeBlockedMessage();
  }
  return txErrorMessage(err);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollDstOwner(
  tokenId: bigint,
  recipient: Address,
  dstChainId: number,
  signal: AbortSignal,
): Promise<boolean> {
  const client = getBridgeReadClient(dstChainId);
  const token = bridgeTokenAddress(dstChainId);
  if (!token) return false;
  const deadline = Date.now() + BRIDGE_DELIVERY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (signal.aborted) return false;
    try {
      const owner = getAddress(
        (await client.readContract({
          address: token,
          abi: KarPassportAbi,
          functionName: "ownerOf",
          args: [tokenId],
        })) as Address,
      );
      if (owner === recipient) return true;
    } catch {
      // Token not yet minted on destination / transient RPC
    }
    await wait(BRIDGE_DELIVERY_POLL_MS);
  }
  return false;
}

/**
 * Directional bridge hook. Defaults to hub→spoke so existing callers stay valid.
 * Spoke→hub: `useBridge(BRIDGE_SPOKE_CHAIN_ID, counterpart, tokenId)`.
 */
export function useBridge(
  srcChainId: number = BRIDGE_HUB_CHAIN_ID,
  dstChainId: number =
    bridgeCounterpartChainId(srcChainId) ?? BRIDGE_SPOKE_CHAIN_ID,
  tokenId: string = "",
) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: wagmiChainId(srcChainId) });
  const { writeContractAsync } = useWriteContract();
  const { runTx, awaitReceipt, runFlow, busy: syncBusy, error: syncError } =
    useTxSync(srcChainId);

  const [phase, setPhase] = useState<BridgePhase>("idle");
  const [feeWei, setFeeWei] = useState<bigint | null>(null);
  const [guid, setGuid] = useState<Hex | null>(null);
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const adapter = bridgeAdapterAddress(srcChainId);
  const passport = karPassportAddress(srcChainId);
  const dstEid = bridgeDstEid(srcChainId);

  const { isApproved, ensureApproved } = usePassportApproval({
    chainId: srcChainId,
    tokenId,
    spender: adapter,
    enabled: Boolean(adapter && tokenId),
  });

  const error = localError ?? syncError;
  const busy = syncBusy || phase === "pending" || phase === "quoting";

  const readSrcTokenUri = useCallback(
    async (tokenId: bigint): Promise<string> => {
      if (!publicClient || !passport) {
        throw new Error("Bridge is not configured on this chain.");
      }
      return (await publicClient.readContract({
        address: passport,
        abi: KarPassportAbi,
        functionName: "tokenURI",
        args: [tokenId],
      })) as string;
    },
    [passport, publicClient],
  );

  const buildSrcSendParam = useCallback(
    async (
      tokenId: bigint,
      recipient: Address,
    ): Promise<BridgeSendParam> => {
      if (dstEid == null) {
        throw new Error("Bridge is not configured on this chain.");
      }
      const tokenUri = await readSrcTokenUri(tokenId);
      return buildSendParam({
        dstEid,
        recipient,
        tokenId,
        tokenUri,
      });
    },
    [dstEid, readSrcTokenUri],
  );

  const quote = useCallback(
    async (tokenId: bigint) => {
      if (!publicClient || !adapter || !passport || !address || dstEid == null) {
        setLocalError("Bridge is not configured on this chain.");
        setPhase("error");
        return null;
      }
      setLocalError(null);
      setPhase("quoting");
      try {
        const sendParam = await buildSrcSendParam(tokenId, getAddress(address));
        const fee = await quoteMessagingFee({
          publicClient,
          adapter,
          sendParam,
        });
        setFeeWei(fee.nativeFee);
        setPhase("idle");
        return fee.nativeFee;
      } catch (err) {
        setLocalError(mapBridgeError(err));
        setPhase("error");
        return null;
      }
    },
    [address, adapter, buildSrcSendParam, dstEid, passport, publicClient],
  );

  const bridge = useCallback(
    async (tokenId: bigint) => {
      return runFlow(async () => {
        setLocalError(null);
        setGuid(null);
        setScanUrl(null);

        if (!publicClient || !adapter || !passport || !address || dstEid == null) {
          setLocalError("Bridge is not configured on this chain.");
          setPhase("error");
          return false;
        }

        const recipient = getAddress(address);

        try {
          // One SendParam for quote + send (URI-length extraOptions must match fee).
          const sendParam = await buildSrcSendParam(tokenId, recipient);

          if (isApproved !== true) {
            setPhase("approving");
            await ensureApproved((hash) =>
              awaitReceipt(hash, { mapError: mapBridgeError }),
            );
          }

          setPhase("quoting");
          const fee = await quoteMessagingFee({
            publicClient,
            adapter,
            sendParam,
          });
          setFeeWei(fee.nativeFee);

          setPhase("sending");
          const result = await runTx(
            () =>
              writeContractAsync({
                address: adapter,
                abi: KarPassportBridgeGatewayAbi,
                functionName: "send",
                args: [...sendArgs(sendParam, fee, recipient)],
                value: fee.nativeFee,
                chainId: wagmiChainId(srcChainId),
              }),
            { mapError: mapBridgeError },
          );

          if (!result) {
            setPhase("error");
            return false;
          }

          const sentGuid = onftSentGuidFromLogs(
            KarPassportBridgeGatewayAbi,
            result.receipt.logs,
          );
          setGuid(sentGuid);
          setScanUrl(layerZeroScanTxUrl(sentGuid));

          const originChainId = parsePassportTokenId(tokenId).chainId;
          const mode: BridgeDirectionMode = deriveBridgeDirectionMode({
            custodyChainId: srcChainId,
            originChainId,
          });
          const tokenIdStr = tokenId.toString();
          const sentAt = Date.now();
          upsertBridgeTransit(address, {
            tokenId: tokenIdStr,
            srcChainId,
            dstChainId,
            recipient,
            guid: sentGuid,
            sentAt,
            mode,
            phase: "source_confirmed",
          });

          abortRef.current?.abort();
          const controller = new AbortController();
          abortRef.current = controller;

          setPhase("pending");
          upsertBridgeTransit(address, {
            tokenId: tokenIdStr,
            srcChainId,
            dstChainId,
            recipient,
            guid: sentGuid,
            sentAt,
            mode,
            phase: "in_flight",
          });

          const delivered = await pollDstOwner(
            tokenId,
            recipient,
            dstChainId,
            controller.signal,
          );

          if (controller.signal.aborted) {
            setPhase("idle");
            return false;
          }

          if (!delivered) {
            upsertBridgeTransit(address, {
              tokenId: tokenIdStr,
              srcChainId,
              dstChainId,
              recipient,
              guid: sentGuid,
              sentAt,
              mode,
              phase: "timed_out",
            });
            setLocalError(
              `Bridge sent, but delivery was not confirmed on ${shortChainName(dstChainId)} within 10 minutes. Check LayerZero Scan.`,
            );
            setPhase("error");
            return false;
          }

          upsertBridgeTransit(address, {
            tokenId: tokenIdStr,
            srcChainId,
            dstChainId,
            recipient,
            guid: sentGuid,
            sentAt,
            mode,
            phase: "indexer_catchup",
          });
          setPhase("delivered");
          return true;
        } catch (err) {
          setLocalError(mapBridgeError(err));
          setPhase("error");
          return false;
        }
      });
    },
    [
      address,
      adapter,
      awaitReceipt,
      buildSrcSendParam,
      dstChainId,
      dstEid,
      ensureApproved,
      isApproved,
      passport,
      publicClient,
      runFlow,
      runTx,
      srcChainId,
      writeContractAsync,
    ],
  );

  return {
    quote,
    bridge,
    phase,
    feeWei,
    guid,
    scanUrl,
    busy,
    error,
    configured: Boolean(adapter && passport && dstEid != null),
  };
}
