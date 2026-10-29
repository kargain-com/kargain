/**
 * Emit atomic views-switch SQL on stdout for:
 *   psql --single-transaction -v ON_ERROR_STOP=1
 *
 * Table/view names are passed as JSON (--tables-json / --views-json) so this
 * module never shells out — the executor gathers names via psql first.
 */
import {
  generateViewsSwitchSql,
  type ViewsSwitchKind,
} from "./lib/ponder-views-switch.js";

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const targetSchema = argValue(argv, "--target-schema");
  const kind = argValue(argv, "--kind") as ViewsSwitchKind | undefined;
  const renameLiveTo = argValue(argv, "--rename-live-to");
  const tablesJson = argValue(argv, "--tables-json") ?? "[]";
  const viewsJson = argValue(argv, "--views-json") ?? "[]";
  if (!targetSchema || !kind || !renameLiveTo) {
    process.stderr.write(
      "usage: ponder-views-switch-cli --target-schema --kind --rename-live-to [--tables-json] [--views-json]\n",
    );
    process.exit(2);
  }
  if (kind !== "normal" && kind !== "first_cutover") {
    process.stderr.write(`invalid kind ${kind}\n`);
    process.exit(2);
  }
  const tableNames = JSON.parse(tablesJson) as string[];
  const viewNames = JSON.parse(viewsJson) as string[];
  const sql = generateViewsSwitchSql({
    targetSchema,
    kind,
    renameLiveTo,
    tableNames,
    viewNames,
  });
  process.stdout.write(sql);
}

main();
