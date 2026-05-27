import { runCli } from "./helpers/cli.ts";

console.log("Running test with harnessdeck...");
const result1 = await runCli(["--version"]);
console.log("Result 1:", result1.stdout.trim());

console.log("\nRunning test with hd...");
const result2 = await runCli(["--version"], { commandName: "hd" });
console.log("Result 2:", result2.stdout.trim());

console.log("\nRunning help test with hd...");
const result3 = await runCli(["--help"], { commandName: "hd" });
const containsHd = result3.stdout.includes("hd");
const containsUsage = result3.stdout.includes("hd [options] [command]");
console.log("Contains 'hd'?", containsHd);
console.log("Contains 'hd [options] [command]'?", containsUsage);
if (!containsHd || !containsUsage) {
  console.log("First 1000 chars of help output:");
  console.log(result3.stdout.substring(0, 1000));
}
