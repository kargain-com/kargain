/**
 * Solana RPC fetch surface for svm-ingest (injectable for tests).
 */

import { Connection } from "@solana/web3.js";

export type FetchedBlock = {
  slot: number;
  transactions: FetchedBlockTransaction[];
};

export type FetchedBlockTransaction = {
  signature: string;
  metaErr: unknown;
  logMessages: string[] | null;
};

export type SvmRpcClient = {
  getSlot: () => Promise<number>;
  getFirstAvailableBlock: () => Promise<number>;
  getBlock: (slot: number) => Promise<FetchedBlock | null>;
};

export function createSolanaRpcClient(rpcUrl: string): SvmRpcClient {
  const connection = new Connection(rpcUrl, "confirmed");
  return {
    async getSlot() {
      return connection.getSlot("confirmed");
    },
    async getFirstAvailableBlock() {
      return connection.getFirstAvailableBlock();
    },
    async getBlock(slot) {
      const block = await connection.getBlock(slot, {
        maxSupportedTransactionVersion: 0,
        transactionDetails: "full",
        rewards: false,
      });
      if (!block) return null;
      const txs: FetchedBlockTransaction[] = [];
      for (const tx of block.transactions) {
        const signature =
          tx.transaction.signatures[0] ??
          (() => {
            throw new Error(`block ${slot} tx missing signature`);
          })();
        txs.push({
          signature,
          metaErr: tx.meta?.err ?? null,
          logMessages: tx.meta?.logMessages ?? null,
        });
      }
      return { slot, transactions: txs };
    },
  };
}
