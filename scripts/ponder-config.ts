import { formatPonderConfigReport } from "./lib/ponder-config-report.js";

function main(): void {
  const { lines, ok } = formatPonderConfigReport(process.env);
  console.log(lines.join("\n"));
  if (!ok) process.exitCode = 1;
}

main();
