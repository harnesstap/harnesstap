import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("CLI add", () => {
  it("installs skills globally with non-interactive flags", async () => {
    const context = await createTestContext("cli-add-global");
    try {
      await runCli(["init", "--main", "codex", "--aliases", "claude-code"]);
      const result = await runCli([
        "add", fixture,
        "--skill", "caveman",
        "--global",
        "--yes",
        "--format", "json",
      ]);
      expect(result.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.installed).toContain("caveman");
      expect(existsSync(join(context.homeDir, ".agents/skills/caveman"))).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("lists discovered skills with --list", async () => {
    const context = await createTestContext("cli-add-list");
    try {
      const result = await runCli(["add", fixture, "--list", "--format", "json"]);
      expect(result.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.skills.map((s: { name: string }) => s.name)).toContain("tdd");
    } finally {
      await context.cleanup();
    }
  });
});
