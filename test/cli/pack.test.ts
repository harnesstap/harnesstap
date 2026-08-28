import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";
import { runCli } from "../helpers/cli.ts";
import { getPluginByName, getPluginResources } from "../../src/models/plugin-model.ts";

function writePackableProject(projectDir: string): void {
  writeTextFile(
    join(projectDir, "apm.yml"),
    `name: cli-pack
version: "1.0.0"
description: CLI pack fixture
`,
  );
  writeTextFile(
    join(projectDir, ".apm", "skills", "ship", "SKILL.md"),
    "---\nname: ship\ndescription: Ship it\n---\n# Ship from pack\n",
  );
}

describe("ht pack", () => {
  it("packs from apm.yml and prints the share line", async () => {
    const context = await createTestContext("cli-pack-success");
    try {
      await runCli(["init"]);
      writePackableProject(context.projectDir);

      const result = await runCli(["pack", "--verbose"]);
      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("Packed");
      expect(result.stdout).toContain("skills/ship/SKILL.md");
      expect(result.stdout).toContain("Share with:");
      expect(result.stdout).toContain("apply");
      expect(existsSync(join(context.projectDir, "build", "cli-pack", "plugin.json"))).toBe(
        true,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("applies a packed directory and a zip, and rejects a tampered bundle", async () => {
    const context = await createTestContext("cli-pack-apply");
    try {
      await runCli(["init"]);
      writePackableProject(context.projectDir);

      const packed = await runCli(["pack", "--format", "json"]);
      const payload = JSON.parse(packed.stdout) as { output: string };
      expect(payload.output).toContain("cli-pack");

      const applyDir = await runCli([
        "apply",
        payload.output,
        "--project",
        context.projectDir,
        "--harness",
        "codex",
        "--no-interactive",
      ]);
      expect(applyDir.exitCode ?? 0).toBe(0);
      const plugin = getPluginByName("cli-pack", "1.0.0");
      expect(plugin).toBeDefined();
      expect(
        getPluginResources(plugin!.id).some(
          (resource) => resource.type === "skill" && resource.name === "ship",
        ),
      ).toBe(true);
      expect(existsSync(join(context.projectDir, "plugin.json"))).toBe(false);

      const archived = await runCli(["pack", "--archive", "-o", "dist", "--format", "json"]);
      const zipPayload = JSON.parse(archived.stdout) as { output: string };
      expect(zipPayload.output.endsWith(".zip")).toBe(true);

      const applyZip = await runCli([
        "apply",
        zipPayload.output,
        "--project",
        context.projectDir,
        "--harness",
        "codex",
        "--no-interactive",
      ]);
      expect(applyZip.exitCode ?? 0).toBe(0);

      writeFileSync(join(payload.output, "skills", "ship", "SKILL.md"), "# Tampered\n");
      const tampered = await runCli([
        "apply",
        payload.output,
        "--project",
        context.projectDir,
        "--harness",
        "codex",
        "--no-interactive",
      ]);
      expect(tampered.exitCode).toBe(1);
      expect(tampered.stderr + tampered.stdout).toMatch(/hash mismatch|Bundle hash/i);
    } finally {
      await context.cleanup();
    }
  });

  it("fails without apm.yml", async () => {
    const context = await createTestContext("cli-pack-missing-manifest");
    try {
      await runCli(["init"]);
      const result = await runCli(["pack"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr + result.stdout).toContain("apm.yml");
    } finally {
      await context.cleanup();
    }
  });

  it("dry-run does not write output", async () => {
    const context = await createTestContext("cli-pack-dry-run");
    try {
      await runCli(["init"]);
      writePackableProject(context.projectDir);
      const result = await runCli(["pack", "--dry-run", "--format", "json"]);
      const payload = JSON.parse(result.stdout) as { dry_run: boolean; output: string };
      expect(payload.dry_run).toBe(true);
      expect(existsSync(payload.output)).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});
