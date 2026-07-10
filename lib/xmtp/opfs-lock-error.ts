import { OpfsInitializationError, OpfsNotInitializedError } from "@xmtp/client";

export function isOpfsLockError(error: unknown): boolean {
  if (error instanceof OpfsInitializationError || error instanceof OpfsNotInitializedError) {
    return true;
  }

  if (error instanceof Error) {
    const { name } = error;
    if (name === "OpfsInitializationError" || name === "OpfsNotInitializedError") {
      return true;
    }
  }

  return false;
}

export const OPFS_LOCK_ERROR_MESSAGE =
  "Messages are already open in another Kargain tab. Close it and retry.";
