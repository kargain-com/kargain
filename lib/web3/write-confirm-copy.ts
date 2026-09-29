/**
 * Sole sentences for non-ok write confirm outcomes that are not program errors.
 * Covers both VMs: expired / status_unknown (SVM) and reverted / superseded (EVM).
 */

export function writeConfirmExpiredCopy(): string {
  return "The transaction expired before it landed. Nothing was written — you can submit again.";
}

export function writeConfirmStatusUnknownCopy(): string {
  return "The network did not confirm the transaction in time. It may still land — check the explorer before submitting again.";
}

export function writeConfirmRevertedCopy(): string {
  return "The transaction was included but reverted. Nothing changed except the network fee.";
}

export function writeConfirmSupersededCopy(): string {
  return "The transaction was cancelled or replaced in your wallet. Nothing was written.";
}
