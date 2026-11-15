import { formatPonderConfigReport } from "./lib/ponder-config-report.js";

function main(): void {
  const { lines, ok } = formatPonderConfigReport(process.env);
  console.log(lines.join("\n"));
  if (!ok) process.exit(1);
}

main();
