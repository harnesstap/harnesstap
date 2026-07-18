import { runCli } from "./helpers/cli.ts";

console.log("Running test with harnesstap...");
const result1 = await runCli(["--version"]);
console.log("Result 1:", result1.stdout.trim());

console.log("\nRunning test with ht...");
const result2 = await runCli(["--version"], { commandName: "ht" });
console.log("Result 2:", result2.stdout.trim());

console.log("\nRunning help test with ht...");
const result3 = await runCli(["--help"], { commandName: "ht" });
const containsHd = result3.stdout.includes("ht");
const containsUsage = result3.stdout.includes("ht [options] [command]");
console.log("Contains 'ht'?", containsHd);
console.log("Contains 'ht [options] [command]'?", containsUsage);
if (!containsHd || !containsUsage) {
  console.log("First 1000 chars of help output:");
  console.log(result3.stdout.substring(0, 1000));
}
