/** Extra bytes reserved for bundle overhead when pre-funding multi-file uploads. */
export const BUNDLE_OVERHEAD_BYTES = 16_384;

/** Mirrors Irys pre-fund byte calculation in irys-client ensureFunded. */
export function estimateIrysUploadBytes(totalFileBytes: number): number {
  return Math.ceil(totalFileBytes * 1.15) + BUNDLE_OVERHEAD_BYTES;
}

export function sumFileBytes(files: Pick<File, "size">[]): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}

export function formatUploadSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
