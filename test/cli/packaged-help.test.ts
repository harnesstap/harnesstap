import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { loadScenarioGuide } from "../../src/services/scenario-guide.ts";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

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

  it("documents bun x and the 1.3 harness flag note", () => {
    expect(readme).toContain("bun x harnesstap@latest init");
    expect(readme).not.toContain("bunx harnesstap");
    expect(readme).toContain("Available from 1.3. On 1.2, use `ht harness set`.");
  });
});
