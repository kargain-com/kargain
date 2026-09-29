"use client";

/**
 * Sole React owner for Irys deposit EVM/SVM ports.
 * Wizards pass the result into upload doors — no VM fork for deposit wiring.
 */

import type { Wallet } from "@wallet-standard/base";
import { useConfig } from "wagmi";

import {
  buildIrysDepositPorts,
  type IrysDepositPorts,
} from "@/lib/storage/irys-deposit";
import { confirmEvmTransactionConfirmations } from "@/lib/web3/evm-tx-confirm";
import { useEvmSendTransaction } from "@/lib/web3/evm-write-adapter";
import { useActiveAccount } from "@/hooks/use-active-account";
import { commercialActive } from "@/lib/web3/commercial-active";
import { commercialNamespaceOf } from "@/lib/web3/active-account";

/**
 * Build deposit ports from wagmi send + session switchChain + confirm owner.
 * Optional `svmWallet` overrides the active-account wallet (callers that already hold it).
 * SVM defaults come from {@link buildIrysDepositPorts} (no VM branch here).
 */
export function useIrysDepositPorts(
  svmWallet?: Wallet | null,
): IrysDepositPorts {
  const { sendTransactionAsync } = useEvmSendTransaction();
  const config = useConfig();
  const { switchChain, svmWallet: sessionSvmWallet, account } =
    useActiveAccount();
  const wallet = svmWallet !== undefined ? svmWallet : sessionSvmWallet;

  const ports: IrysDepositPorts = {
    sendEvmTransaction: {
      sendTransaction: ({ to, value, chainId }) =>
        sendTransactionAsync({ to, value, chainId }),
    },
    switchChain: (chainId) => switchChain(chainId),
    waitEvmConfirmations: ({ txHash, minConfirmations, chainId }) =>
      confirmEvmTransactionConfirmations(
        config,
        txHash,
        minConfirmations,
        chainId,
      ),
  };

  const ns = commercialNamespaceOf(account);
  if (ns.ok) {
    const stack = commercialActive(Number(ns.namespace));
    if (stack != null) {
      Object.assign(
        ports,
        buildIrysDepositPorts({ stack, svmWallet: wallet }),
      );
    }
  }

  return ports;
}
