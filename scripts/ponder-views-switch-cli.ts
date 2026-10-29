/**
 * Emit atomic views-switch SQL on stdout for:
 *   psql --single-transaction -v ON_ERROR_STOP=1
 *
 * Table/view names are passed as JSON (--tables-json / --views-json).
 * No empty defaults (B1): parsePonderMetaNamesResult refuses absent/empty.
 */
import {
  generateViewsSwitchSql,
  parsePonderMetaNamesResult,
  type ViewsSwitchKind,
} from "./lib/ponder-views-switch.js";

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function main(): void {
  const argv = process.argv.slice(2);
  const targetSchema = argValue(argv, "--target-schema");
  const kind = argValue(argv, "--kind") as ViewsSwitchKind | undefined;
  const renameLiveTo = argValue(argv, "--rename-live-to");
  const tablesJson = argValue(argv, "--tables-json");
  const viewsJson = argValue(argv, "--views-json");
  const rowPresent = !hasFlag(argv, "--no-row");

  if (!targetSchema || !kind || !renameLiveTo) {
    process.stderr.write(
      "usage: ponder-views-switch-cli --target-schema --kind --rename-live-to [--tables-json] [--views-json]\n",
    );
    process.exit(2);
  }
  if (
    kind !== "normal" &&
    kind !== "first_cutover" &&
    kind !== "first_cutover_rollback"
  ) {
    process.stderr.write(`invalid kind ${kind}\n`);
    process.exit(2);
  }

  let tableNames: string[] = [];
  let viewNames: string[] = [];

  if (kind === "first_cutover_rollback") {
    // Rename-only path — meta names unused.
  } else {
    try {
      const parsed = parsePonderMetaNamesResult({
        tableNamesJson: tablesJson,
        viewNamesJson: viewsJson,
        rowPresent: rowPresent && tablesJson !== undefined,
      });
      tableNames = parsed.tableNames;
      viewNames = parsed.viewNames;
    } catch (err) {
      process.stderr.write(
        `${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
  }

  try {
    const sql = generateViewsSwitchSql({
      targetSchema,
      kind,
      renameLiveTo,
      tableNames,
      viewNames,
    });
    process.stdout.write(sql);
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

main();
