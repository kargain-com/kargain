/**
 * Sole owner of static-import specifier extraction for deploy fingerprints and
 * product import-graph policies. Built on TypeScript `preProcessFile` so
 * side-effect imports, `require`, and literal `import()` are not dropped.
 *
 * Guard: test/static-import-specifiers.test.ts
 */

import ts from "typescript";

/**
 * Return every literal module specifier reachable as a static edge from
 * `source`. Order follows TypeScript preprocess discovery (stable for a given
 * TypeScript version). Specifiers that appear only inside comments or string
 * literals do not yield an edge.
 */
export function extractStaticImportSpecifiers(source: string): string[] {
  const info = ts.preProcessFile(source, true, true);
  return info.importedFiles.map((f) => f.fileName);
}
