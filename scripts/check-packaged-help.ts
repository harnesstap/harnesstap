import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const TOP_LEVEL = new Set([
  "init",
  "add",
  "apply",
  "install",
  "compile",
  "targets",
  "scan",
  "status",
  "history",
  "revert",
  "mirror",
  "resource",
  "plugin",
  "profile",
  "environment",
  "harness",
  "auth",
  "github",
  "migrate",
  "marketplace",
  "mcp",
  "lock",
  "pack",
  "audit",
  "approve",
  "deny",
  "help",
  "config",
  "open",
  "use",
]);

function extractReadmeHtLines(readme: string): string[] {
  const lines: string[] = [];
  const fence = /```bash\n([\s\S]*?)```/g;
  for (const match of readme.matchAll(fence)) {
    const block = match[1];
    if (!block) continue;
    for (const raw of block.split("\n")) {
      const line = raw.replace(/#.*$/, "").trim();
      if (line.startsWith("ht ") || line === "ht") {
        lines.push(line);
      }
    }
  }
  return lines;
}

function helpArgv(line: string): string[] | null {
  const tokens = line.split(/\s+/);
  const rest = tokens.slice(1);
  const path: string[] = [];
  for (const token of rest) {
    if (token.startsWith("-") || token.startsWith(".") || token.includes("/")) {
      break;
    }
    if (token.startsWith('"') || token.includes("<") || token.includes(">")) {
      break;
    }
    path.push(token);
  }
  if (path.length === 0) {
    return ["--help"];
  }
  if (!TOP_LEVEL.has(path[0] ?? "")) {
    return null;
  }
  // `ht resource scope <name> --add <harness,...>` (PR-9). Check the subcommand help once it exists.
  if (path[0] === "resource" && path[1] === "scope") {
    return ["resource", "scope", "--help"];
  }
  return [...path, "--help"];
}

function run(bin: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf-8",
    env,
    timeout: 30_000,
  });
}

const tarball = readdirSync(repoRoot).find((name) => /^harnesstap-.*\.tgz$/.test(name));
if (!tarball) {
  console.error("G7: no harnesstap-*.tgz in repo root. Run npm pack first.");
  process.exit(1);
}

const extractRoot = mkdtempSync(join(tmpdir(), "ht-g7-"));
const home = mkdtempSync(join(tmpdir(), "ht-g7-home-"));
const extract = spawnSync("tar", ["-xzf", join(repoRoot, tarball), "-C", extractRoot], {
  encoding: "utf-8",
});
if (extract.status !== 0) {
  console.error(extract.stderr || extract.stdout);
  process.exit(extract.status ?? 1);
}
const bin = join(extractRoot, "package", "dist", "bin.js");
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  FORCE_COLOR: "0",
  NO_COLOR: "1",
  HARNESSTAP_TELEMETRY: "0",
  HARNESSTAP_UPDATE_CHECK: "0",
};

const help = run(bin, ["help"], env);
if (help.status !== 0 || !(help.stdout ?? "").trim()) {
  console.error("G7: ht help failed", help.status, help.stderr, help.stdout);
  process.exit(1);
}
const scenario = run(bin, ["help", "scenario", "1"], env);
if (scenario.status !== 0 || !(scenario.stdout ?? "").trim()) {
  console.error("G7: ht help scenario 1 failed", scenario.status, scenario.stderr, scenario.stdout);
  process.exit(1);
}

const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");
const failures: string[] = [];
for (const line of extractReadmeHtLines(readme)) {
  const argv = helpArgv(line);
  if (!argv) {
    continue;
  }
  const result = run(bin, argv, env);
  if (result.status !== 0) {
    failures.push(`${line} -> ht ${argv.join(" ")} (exit ${result.status})\n${result.stderr}`);
  }
}
const scopeHelp = run(bin, ["resource", "scope", "--help"], env);
if (scopeHelp.status !== 0) {
  const text = `${scopeHelp.stderr ?? ""}\n${scopeHelp.stdout ?? ""}`;
  const notShippedYet = /unknown command|too many arguments|error: unknown/i.test(text);
  if (!notShippedYet) {
    failures.push(`ht resource scope --help (exit ${scopeHelp.status})\n${text}`);
  }
}

if (failures.length > 0) {
  console.error("G7: README commands failed --help:\n", failures.join("\n"));
  process.exit(1);
}

console.log("G7 packaged help and README commands ok");
