/**
 * Sole owner of the file-wide TypeScript suppression ban.
 * Tracked `.ts`/`.tsx` may not carry a `@ts-nocheck` pragma except the
 * named exception list (empty — keep it that way).
 *
 * Guard: test/ts-nocheck-policy.test.ts
 */

/** Repo-relative paths allowed to carry a file-wide nocheck pragma. */
export const TS_NOCHECK_EXCEPTIONS: readonly string[] = [];

/** File-wide pragma only — not the token in strings or prose. */
export const TS_NOCHECK_PRAGMA_RE = /^\s*(?:\/\/|\/\*)\s*@ts-nocheck\b/m;

export function sourceHasTsNocheckPragma(source: string): boolean {
  return TS_NOCHECK_PRAGMA_RE.test(source);
}

export function findTsNocheckViolations(
  files: ReadonlyArray<{ path: string; source: string }>,
  exceptions: readonly string[] = TS_NOCHECK_EXCEPTIONS,
): string[] {
  const skip = new Set(exceptions);
  return files
    .filter((f) => !skip.has(f.path) && sourceHasTsNocheckPragma(f.source))
    .map((f) => f.path)
    .sort();
}
