/**
 * Sole sentences for non-ok SVM confirm outcomes that are not program errors.
 */

export function svmConfirmExpiredCopy(): string {
  return "The transaction expired before it landed. Nothing was written — you can submit again.";
}

export function svmConfirmStatusUnknownCopy(): string {
  return "The network did not confirm the transaction in time. It may still land — check the explorer before submitting again.";
}
