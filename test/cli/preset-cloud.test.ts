import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { initGitRepo } from "../helpers/git.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI cloud preset workflows", () => {
  it("search, install, publish, apply cloud-installed preset, and conflict handling", async () => {
    const context = await createTestContext("cli-preset-cloud");
    try {
      await runCli(["init"]);

      // preset search should emit JSON when requested
      const search = await runCli(["preset", "search", "team", "--format", "json"]);
      expect(Array.isArray(JSON.parse(search.stdout))).toBe(true);

      // install from a remote selector; use --as to pick local name
      const install = await runCli([
        "preset",
        "install",
        "acme/team@1.0",
        "--as",
        "team-cloud",
        "--format",
        "json",
      ]);
      const installPayload = JSON.parse(install.stdout);
      expect(installPayload).toEqual(
        expect.objectContaining({
          preset_name: "team-cloud",
          org_slug: "acme",
          library_slug: "team",
          version: "1.0",
        }),
      );

      // publish should return JSON when requested
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const preset = presetModel.createPreset({ name: "pubtest" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "r", content: "#x" }),
      );
      presetModel.addResourceToPreset(preset.id, resource.id);

      const publish = await runCli(["preset", "publish", "pubtest", "--format", "json"]);
      expect(JSON.parse(publish.stdout)).toBeDefined();

      // applying a cloud-installed preset through project apply
      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-cloud.git");
      const dryRun = await runCli([
        "project",
        "apply",
        "team-cloud",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--dry-run",
        "--format",
        "json",
      ]);
      expect(JSON.parse(dryRun.stdout)).toEqual(
        expect.objectContaining({ preset: "team-cloud" }),
      );

      // install conflict when local preset name exists and --as missing
      const conflictPreset = presetModel.createPreset({ name: "conflict" });
      const conflict = await runCli(["preset", "install", "org/conflict@1.0"]);
      expect(conflict.stderr).toContain("Preset name already exists");
    } finally {
      await context.cleanup();
    }
  });
});
