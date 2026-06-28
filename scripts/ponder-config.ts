import {
  formatSepoliaStackReport,
  resolveSepoliaStack,
} from "./lib/resolve-sepolia-stack.js";

function main() {
  const stack = resolveSepoliaStack();
  console.log(formatSepoliaStackReport(stack));
}

main();
