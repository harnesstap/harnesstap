import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { formatScenarioCommand } from "../../src/cli/shared.ts";
import { loadScenarioGuide } from "../../src/services/scenario-guide.ts";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import {
  checkCommandSurface,
  findVersionGatedPhrases,
  loadSurface,
  runReleasedGuard,
} from "../../scripts/readme-guard.ts";

const readme = readFileSync(resolve(import.meta.dirname, "../../README.md"), "utf-8");

describe("G7 packaged help sources", () => {
  it("loads scenario 1 from generated playbooks", () => {
    const scenario = loadScenarioGuide(1);
    expect(scenario.id).toBe(1);
    expect(scenario.commands.length).toBeGreaterThan(0);
    expect(scenario.filename).toContain("bootstrap");
  });

  it("prints help and scenario 1 without a local docs path", async () => {
    const context = await createTestContext("cli-g7-help");
    try {
      const help = await runCli(["help"]);
      expect(help.exitCode ?? 0).toBe(0);
      expect(help.stdout.trim().length).toBeGreaterThan(0);

      const scenario = await runCli(["help", "scenario", "1"]);
      expect(scenario.exitCode ?? 0).toBe(0);
      expect(scenario.stdout).toContain("SCENARIO 1");
      expect(scenario.stdout).toContain("github.com/harnesstap/harnesstap/blob/main/docs/scenarios/details/");
      expect(scenario.stdout).not.toContain("Full doc: docs/scenarios/details/");
    } finally {
      await context.cleanup();
    }
  });

  it("documents bun x", () => {
    expect(readme).toContain("bun x harnesstap@latest init");
    expect(readme).not.toContain("bunx harnesstap");
  });

  it("formats the DS-1 scope tip command as ht", () => {
    expect(formatScenarioCommand("resource scope filesystem --add cursor,codex")).toBe(
      "ht resource scope filesystem --add cursor,codex",
    );
    expect(formatScenarioCommand("ht resource scope filesystem --add cursor,codex")).toBe(
      "ht resource scope filesystem --add cursor,codex",
    );
  });
});

describe("G7 README describes only the latest published release", () => {
  const root = resolve(import.meta.dirname, "../..");
  const surface = loadSurface(resolve(root, "scripts/released-cli-surface.json"));

  it("passes for the checked-in README and docs", () => {
    expect(runReleasedGuard(root, surface)).toEqual([]);
  });

  it("fails on version-gated phrases", () => {
    const phrases = [
      "Available from 1.3. On 1.2, use `ht harness set`.",
      "Coming in the next release.",
      "Supported since v1.2.",
      "New in 1.3: profiles.",
    ];
    for (const phrase of phrases) {
      expect(findVersionGatedPhrases("README.md", phrase)).not.toEqual([]);
    }
    expect(findVersionGatedPhrases("README.md", "`ht init` seeds a global default profile.")).toEqual([]);
  });

  it("fails on commands and flags missing from the released package", () => {
    const readme = [
      "```bash",
      "ht init --harnesses codex,cursor   # flag only on main",
      "ht github login",
      "ht resource scope filesystem --add cursor",
      "```",
      "Use `ht harness set --harnesses cursor` or `ht plugin pull`.",
    ].join("\n");
    const messages = checkCommandSurface("README.md", readme, surface).map((finding) => finding.message);
    expect(messages.some((message) => message.includes("--harnesses is not available on `ht init`"))).toBe(true);
    expect(messages.some((message) => message.includes("`ht github` is not a command"))).toBe(true);
    expect(messages.some((message) => message.includes("`ht resource scope` is not a subcommand"))).toBe(true);
    expect(messages.some((message) => message.includes("--harnesses is not available on `ht harness set`"))).toBe(true);
    expect(messages.some((message) => message.includes("ht plugin pull"))).toBe(false);
  });

  it("accepts released commands, aliases, global flags, shorthands, and placeholders", () => {
    const readme = [
      "```bash",
      "ht init --main codex --aliases claude-code,cursor",
      "ht scan .",
      'ht profile use "global default" --dry-run',
      "ht work",
      "ht p list --format json",
      "ht --verbose status . --check",
      "```",
      "Run `ht <name>` or `ht apply <plugin> --project .`.",
    ].join("\n");
    expect(checkCommandSurface("README.md", readme, surface)).toEqual([]);
  });
});
