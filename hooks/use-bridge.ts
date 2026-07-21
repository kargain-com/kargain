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
  BRIDGE_DELIVERY_POLL_MS,
  BRIDGE_DELIVERY_TIMEOUT_MS,
  BRIDGE_HUB_CHAIN_ID,
  BridgeUriTooLongError,
  bridgeAdapterAddress,
  bridgeDstEid,
  bridgeSpokeOnftAddress,
  buildSendParam,
  getSpokeReadClient,
  layerZeroScanTxUrl,
  onftSentGuidFromLogs,
  quoteMessagingFee,
  sendArgs,
  type BridgeSendParam,
} from "@/lib/web3/bridge";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

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
  if (msg.includes("PassportDisputed")) {
    return formatPassportBridgeBlockedMessage();
  }
  if (msg.includes("ListedInMarketplace")) {
    return "Delist this vehicle before bridging.";
  }
  return txErrorMessage(err);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollSpokeOwner(
  tokenId: bigint,
  recipient: Address,
  signal: AbortSignal,
): Promise<boolean> {
  const spoke = getSpokeReadClient();
  const onft = bridgeSpokeOnftAddress();
  const deadline = Date.now() + BRIDGE_DELIVERY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (signal.aborted) return false;
    try {
      const owner = getAddress(
        (await spoke.readContract({
          address: onft,
          // Live spoke is still thin ONFT (ERC721); C2 will poll KarPassport.
          abi: KarPassportAbi,
          functionName: "ownerOf",
          args: [tokenId],
        })) as Address,
      );
      if (owner === recipient) return true;
    } catch {
      // Token not yet minted on spoke / transient RPC
    }
    await wait(BRIDGE_DELIVERY_POLL_MS);
  }
  return false;
}

export function useBridge(hubChainId: number = BRIDGE_HUB_CHAIN_ID) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: wagmiChainId(hubChainId) });
  const { writeContractAsync } = useWriteContract();
  const { runTx, awaitReceipt, runFlow, busy: syncBusy, error: syncError } =
    useTxSync(hubChainId);

  const [phase, setPhase] = useState<BridgePhase>("idle");
  const [feeWei, setFeeWei] = useState<bigint | null>(null);
  const [guid, setGuid] = useState<Hex | null>(null);
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const adapter = bridgeAdapterAddress(hubChainId);
  const passport = karPassportAddress(hubChainId);
  const dstEid = bridgeDstEid(hubChainId);

  const error = localError ?? syncError;
  const busy = syncBusy || phase === "pending" || phase === "quoting";

  const readHubTokenUri = useCallback(
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

  const buildHubSendParam = useCallback(
    async (
      tokenId: bigint,
      recipient: Address,
    ): Promise<BridgeSendParam> => {
      if (dstEid == null) {
        throw new Error("Bridge is not configured on this chain.");
      }
      const tokenUri = await readHubTokenUri(tokenId);
      return buildSendParam({
        dstEid,
        recipient,
        tokenId,
        tokenUri,
      });
    },
    [dstEid, readHubTokenUri],
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
        const sendParam = await buildHubSendParam(tokenId, getAddress(address));
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
    [address, adapter, buildHubSendParam, dstEid, passport, publicClient],
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
          const sendParam = await buildHubSendParam(tokenId, recipient);

          const approved = (await publicClient.readContract({
            address: passport,
            abi: KarPassportAbi,
            functionName: "isApprovedForAll",
            args: [recipient, adapter],
          })) as boolean;

          if (!approved) {
            setPhase("approving");
            const approveHash = await writeContractAsync({
              address: passport,
              abi: KarPassportAbi,
              functionName: "setApprovalForAll",
              args: [adapter, true],
              chainId: wagmiChainId(hubChainId),
            });
            await awaitReceipt(approveHash, { mapError: mapBridgeError });
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
                chainId: wagmiChainId(hubChainId),
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

          abortRef.current?.abort();
          const controller = new AbortController();
          abortRef.current = controller;

          setPhase("pending");
          const delivered = await pollSpokeOwner(
            tokenId,
            recipient,
            controller.signal,
          );

          if (controller.signal.aborted) {
            setPhase("idle");
            return false;
          }

          if (!delivered) {
            setLocalError(
              "Bridge sent, but delivery was not confirmed on Ethereum Sepolia within 10 minutes. Check LayerZero Scan.",
            );
            setPhase("error");
            return false;
          }

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
      buildHubSendParam,
      dstEid,
      hubChainId,
      passport,
      publicClient,
      runFlow,
      runTx,
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
