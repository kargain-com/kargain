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
  KarPassportONFT721Abi,
  ProxyONFT721AdapterAbi,
} from "@/lib/contracts/abis.generated";
import {
  formatPassportBridgeBlockedMessage,
  txErrorMessage,
} from "@/lib/marketplace/tx-error-message";
import {
  BRIDGE_DELIVERY_POLL_MS,
  BRIDGE_DELIVERY_TIMEOUT_MS,
  BRIDGE_HUB_CHAIN_ID,
  bridgeAdapterAddress,
  bridgeDstEid,
  bridgeSpokeOnftAddress,
  buildSendParam,
  getSpokeReadClient,
  layerZeroScanTxUrl,
  onftSentGuidFromLogs,
  quoteMessagingFee,
  sendArgs,
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
          abi: KarPassportONFT721Abi,
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

  const quote = useCallback(
    async (tokenId: bigint) => {
      if (!publicClient || !adapter || !address || dstEid == null) {
        setLocalError("Bridge is not configured on this chain.");
        setPhase("error");
        return null;
      }
      setLocalError(null);
      setPhase("quoting");
      try {
        const sendParam = buildSendParam({
          dstEid,
          recipient: address,
          tokenId,
        });
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
    [address, adapter, dstEid, publicClient],
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
        const sendParam = buildSendParam({
          dstEid,
          recipient,
          tokenId,
        });

        try {
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
                abi: ProxyONFT721AdapterAbi,
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
            ProxyONFT721AdapterAbi,
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
