/**
 * Solana web3.js types for stand files that load the package via createRequire
 * from svm/lab (runtime resolution). Values stay createRequire'd; these aliases
 * are InstanceType of the constructors for annotations only.
 */
import type {
  Connection as ConnectionClass,
  Keypair as KeypairClass,
  PublicKey as PublicKeyClass,
  Transaction as TransactionClass,
  TransactionInstruction as TransactionInstructionClass,
} from "@solana/web3.js";

export type StandConnection = ConnectionClass;
export type StandKeypair = KeypairClass;
export type StandPublicKey = PublicKeyClass;
export type StandTransaction = TransactionClass;
export type StandTransactionInstruction = TransactionInstructionClass;
