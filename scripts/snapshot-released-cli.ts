import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CliSurface, SurfaceNode } from "./readme-guard.ts";

const repoRoot = resolve(import.meta.dir, "..");
const SNAPSHOT_PATH = join(repoRoot, "scripts", "released-cli-surface.json");

interface CommanderOption {
  long?: string;
  short?: string;
}

interface CommanderCommand {
  name(): string;
  aliases(): string[];
  options: CommanderOption[];
  commands: CommanderCommand[];
  registeredArguments?: unknown[];
}

function describe(command: CommanderCommand): SurfaceNode {
  const subcommands: Record<string, SurfaceNode> = {};
  for (const child of [...command.commands].sort((a, b) => a.name().localeCompare(b.name()))) {
    subcommands[child.name()] = describe(child);
  }
  const flags = command.options.flatMap((option) => [option.long, option.short].filter((flag): flag is string => !!flag));
  return {
    aliases: [...command.aliases()].sort(),
    flags: [...new Set(flags)].sort(),
    args: command.registeredArguments?.length ?? 0,
    subcommands,
  };
}

function usage(message: string): never {
  console.error(message);
  console.error("Usage: bun scripts/snapshot-released-cli.ts [--version <x.y.z> | --from-source] [--check]");
  process.exit(1);
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function installPublished(version: string, dir: string): string {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const result = spawnSync(
      "npm",
      ["install", "--prefix", dir, "--no-audit", "--no-fund", "--loglevel=error", `harnesstap@${version}`],
      { encoding: "utf-8" },
    );
    if (result.status === 0) return join(dir, "node_modules", "harnesstap", "dist", "index.js");
    if (attempt === 4) usage(`npm install harnesstap@${version} failed:\n${result.stderr}`);
    sleep(15_000);
  }
  return usage("unreachable");
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const fromSource = args.includes("--from-source");
const versionFlag = args.indexOf("--version");
const requested = versionFlag >= 0 ? args[versionFlag + 1]?.replace(/^v/, "") : undefined;
if (fromSource && requested) usage("Pass either --version or --from-source.");
if (versionFlag >= 0 && !requested) usage("--version needs a value.");

const home = mkdtempSync(join(tmpdir(), "ht-surface-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.HARNESSTAP_TELEMETRY = "0";
process.env.HARNESSTAP_UPDATE_CHECK = "0";

let entry: string;
let version: string;
if (fromSource) {
  entry = join(repoRoot, "src", "index.ts");
  version = (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as { version: string }).version;
} else {
  const lookedUp = requested ?? spawnSync("npm", ["view", "harnesstap", "version"], { encoding: "utf-8" }).stdout.trim();
  if (!lookedUp) usage("Could not resolve the latest published version from npm.");
  version = lookedUp;
  entry = installPublished(version, mkdtempSync(join(tmpdir(), "ht-surface-pkg-")));
}

/** Root flags a build handles before commander parses argv, so they are missing from the command tree. */
function probeRootFlags(entryPath: string): string[] {
  return ["--version", "--harnesstap-version", "-V"].filter((flag) => {
    const script = `const m = await import(${JSON.stringify(pathToFileURL(entryPath).href)}); await m.runHarnesstapCli(["bun", "ht", ${JSON.stringify(flag)}]);`;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf-8", env: process.env });
    return result.status === 0 && /^\d+\.\d+\.\d+\S*\s*$/.test(result.stdout);
  });
}

const loaded = (await import(pathToFileURL(entry).href)) as {
  program: CommanderCommand;
  runHarnesstapCli?: (argv: string[]) => Promise<void>;
};
// Builds from 1.3.0 register command groups lazily, so the exported program is
// empty until a run loads them. Shell completion loads every group without
// executing a command; silence its candidate list.
if (loaded.program.commands.length === 0 && loaded.runHarnesstapCli) {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    await loaded.runHarnesstapCli(["bun", "ht", "__complete", "0", ""]);
  } finally {
    process.stdout.write = write;
  }
  process.exitCode = 0;
}
if (loaded.program.commands.length === 0) usage(`harnesstap@${version} exposed no commands to snapshot.`);
const root = describe(loaded.program);
root.flags = [...new Set([...root.flags, ...probeRootFlags(entry)])].sort();
const surface: CliSurface = { version, root };
const next = `${JSON.stringify(surface, null, 2)}\n`;

if (check) {
  const current = readFileSync(SNAPSHOT_PATH, "utf-8");
  if (current !== next) {
    console.error(
      `scripts/released-cli-surface.json does not match harnesstap@${version}. ` +
        "Run `bun run snapshot:released-cli` and commit the result.",
    );
    process.exit(1);
  }
  console.log(`released CLI surface matches harnesstap@${version}`);
} else {
  writeFileSync(SNAPSHOT_PATH, next);
  console.log(`wrote ${SNAPSHOT_PATH} from harnesstap@${version}`);
}
process.exit(0);
