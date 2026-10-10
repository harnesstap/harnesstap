import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { jsonReplacer } from "../../src/utils/output-format.ts";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

const repoRoot = resolve(import.meta.dirname, "../..");

function runPackedCli(homeDir: string, args: string[]) {
  return spawnSync(process.execPath, [resolve(repoRoot, "src/bin.ts"), ...args], {
    cwd: homeDir,
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      HARNESSTAP_TELEMETRY: "",
      HARNESSTAP_UPDATE_CHECK: "0",
    },
  });
}

function parseStdoutJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  expect(trimmed.length).toBeGreaterThan(0);
  return JSON.parse(trimmed);
}

describe("jsonReplacer", () => {
  it("serializes Set as a sorted array and Map as an object", () => {
    const encoded = JSON.stringify(
      { supports: new Set(["skill", "hook"]), extra: new Map([["a", 1]]) },
      jsonReplacer,
    );
    expect(JSON.parse(encoded)).toEqual({
      supports: ["hook", "skill"],
      extra: { a: 1 },
    });
  });
});

describe("G5 JSON stdout purity", () => {
  it("parses first-run harness list json without telemetry on stdout", async () => {
    const context = await createTestContext("cli-g5-json-purity");
    try {
      const home = join(context.rootDir, "fresh-home");
      mkdirSync(home, { recursive: true });
      const result = runPackedCli(home, ["harness", "list", "--format", "json"]);
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("Anonymous usage telemetry");
      const parsed = parseStdoutJson(result.stdout) as Array<{ supports?: unknown }>;
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      const supports = parsed[0]?.supports;
      expect(Array.isArray(supports)).toBe(true);
      expect(supports).not.toEqual({});
    } finally {
      await context.cleanup();
    }
  });

  it("parses plugin, resource, profile, and environment list json", async () => {
    const context = await createTestContext("cli-g5-json-lists");
    try {
      await runCli(["init", "--no-interactive"]);
      const commands = [
        ["plugin", "list", "--format", "json"],
        ["resource", "list", "--format", "json"],
        ["profile", "list", "--format", "json"],
        ["environment", "list", "--format", "json"],
        ["harness", "list", "--format", "json"],
      ];
      for (const args of commands) {
        const result = await runCli(args);
        expect(result.exitCode ?? 0, args.join(" ")).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed, args.join(" ")).toBeDefined();
        expect(result.stdout, args.join(" ")).not.toContain("Anonymous usage telemetry");
      }
    } finally {
      await context.cleanup();
    }
  });
});
