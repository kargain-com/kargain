export function evmWriterOrderKey(
  chainId: number,
  blockNumber: number,
  logIndex: number,
): string {
  return `${chainId}-${blockNumber}-${logIndex}`;
}

export function svmWriterOrderKey(
  namespace: number,
  slot: number,
  txIndexInBlock: number,
  logIndex: number,
): string {
  return `${namespace}-${slot}-${txIndexInBlock}-${logIndex}`;
}

export function writerIdFromOrderKey(writerOrderKey: string): string {
  return writerOrderKey.split("-")[0] ?? writerOrderKey;
}

/** Total order within one writer — numeric segment compare only. */
export function compareWriterOrderKeys(a: string, b: string): number {
  const pa = a.split("-").map((s) => Number(s));
  const pb = b.split("-").map((s) => Number(s));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}
