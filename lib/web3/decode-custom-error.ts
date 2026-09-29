/**
 * ABI-decode a custom error from a failed contract call.
 * Prefer viem’s structured revert data — never match on `err.message`.
 */

import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Abi,
  type Hex,
} from "viem";

export type DecodedCustomError = {
  readonly name: string;
  readonly args: readonly unknown[] | undefined;
};

function asHexData(value: unknown): Hex | null {
  if (
    typeof value === "string" &&
    /^0x[0-9a-fA-F]*$/.test(value) &&
    value.length >= 10
  ) {
    return value as Hex;
  }
  if (value && typeof value === "object" && "data" in value) {
    return asHexData((value as { data?: unknown }).data);
  }
  return null;
}

/**
 * Walk a wagmi/viem failure (or any object with a `data` hex field) to the
 * raw revert returndata. Returns `null` when no usable hex is present.
 * Sole owner of the hex-data walk — confirm replay and decodeCustomError share it.
 */
export function extractRevertDataHex(error: unknown): Hex | null {
  if (error == null || typeof error !== "object") return null;

  const reverted =
    error instanceof ContractFunctionRevertedError
      ? error
      : error instanceof BaseError
        ? (error.walk(
            (e) => e instanceof ContractFunctionRevertedError,
          ) as ContractFunctionRevertedError | null)
        : null;

  const fromRaw = reverted?.raw as Hex | undefined;
  if (fromRaw != null && fromRaw !== "0x" && asHexData(fromRaw) != null) {
    return asHexData(fromRaw);
  }

  if (error instanceof BaseError) {
    const walked = asHexData(
      error.walk((e) => e != null && typeof e === "object" && "data" in e),
    );
    if (walked != null && walked !== "0x") return walked;
  }

  return asHexData((error as { data?: unknown }).data);
}

/**
 * Decode a known custom-error selector from raw returndata against one ABI.
 * Returns `null` for Error/Panic, unknown selectors, or empty data.
 */
export function decodeCustomErrorData(
  data: Hex,
  abi: Abi,
): DecodedCustomError | null {
  if (data === "0x" || data.length < 10) return null;
  try {
    const decoded = decodeErrorResult({ abi, data });
    if (decoded.errorName === "Error" || decoded.errorName === "Panic") {
      return null;
    }
    return { name: decoded.errorName, args: decoded.args };
  } catch {
    return null;
  }
}

/**
 * Walk a wagmi/viem failure to `{ name, args }` via ABI decode.
 * Returns `null` for transport failures, unknown selectors, or Error/Panic.
 */
export function decodeCustomError(
  error: unknown,
  abi: Abi,
): DecodedCustomError | null {
  if (error == null || typeof error !== "object") return null;

  const reverted =
    error instanceof ContractFunctionRevertedError
      ? error
      : error instanceof BaseError
        ? (error.walk(
            (e) => e instanceof ContractFunctionRevertedError,
          ) as ContractFunctionRevertedError | null)
        : null;

  if (reverted?.data?.errorName) {
    const { errorName, args } = reverted.data;
    if (errorName === "Error" || errorName === "Panic") return null;
    return { name: errorName, args };
  }

  const rawHex = extractRevertDataHex(error);
  if (rawHex == null) return null;
  return decodeCustomErrorData(rawHex, abi);
}
