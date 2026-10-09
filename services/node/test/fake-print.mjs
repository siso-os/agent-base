// A stand-in for a command that prints JSON or text (burn-rate, spend-ledger, quota-axi) in checks: prints the file named
// by its first argument and ignores the rest (`split --day D --json` and the like). Use as AB_LEDGER_CMD="node
// test/fake-print.mjs <file>"; a file that does not exist fails the way a missing command does.
import { readFileSync } from "node:fs";

try {
  process.stdout.write(readFileSync(process.argv[2], "utf8"));
} catch (e) {
  console.error(String(e.message));
  process.exit(1);
}
