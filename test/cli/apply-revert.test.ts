import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("apply revert snapshots (W1-20 / W2-3)", () => {
  it("prints a usable snapshot id and revert removes files apply added", async () => {
    const context = await createTestContext("cli-apply-revert-absent");
    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-apply-revert.git");
      await runCli(["init", "--harnesses", "claude-code"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "review-kit" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          content: "# Applied instructions",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const apply = await runCli([
        "apply",
        "review-kit",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);
      expect(apply.exitCode ?? 0).toBe(0);
      expect(apply.stdout).toContain("Wrote 1");
      expect(apply.stdout).toMatch(/Snapshot saved\. Undo with: ht revert \S+/);
      const claudeMd = join(context.projectDir, "CLAUDE.md");
      expect(existsSync(claudeMd)).toBe(true);

      const match = apply.stdout.match(/ht revert (\S+)/);
      const snapshotId = match?.[1];
      expect(snapshotId).toBeDefined();
      if (!snapshotId) {
        throw new Error("Expected a snapshot id in apply output");
      }

      const second = await runCli([
        "apply",
        "review-kit",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);
      expect(second.stdout).toContain("Everything is up to date.");
      expect(second.stdout).not.toContain("Snapshot saved.");

      const revert = await runCli(["revert", snapshotId]);
      expect(revert.exitCode ?? 0).toBe(0);
      expect(revert.stdout).toContain("Restored");
      expect(revert.stdout).toContain("removed");
      expect(existsSync(claudeMd)).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("keeps a user-modified apply file with a warning", async () => {
    const context = await createTestContext("cli-apply-revert-modified");
    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-apply-revert-mod.git");
      await runCli(["init", "--harnesses", "claude-code"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "review-kit" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "project-context",
          content: "# Applied instructions",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const apply = await runCli([
        "apply",
        "review-kit",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);
      const snapshotId = apply.stdout.match(/ht revert (\S+)/)?.[1];
      expect(snapshotId).toBeDefined();
      if (!snapshotId) {
        throw new Error("Expected a snapshot id");
      }

      const claudeMd = join(context.projectDir, "CLAUDE.md");
      writeFileSync(claudeMd, "# I edited this", "utf-8");

      const revert = await runCli(["revert", snapshotId]);
      expect(revert.exitCode ?? 0).toBe(0);
      expect(`${revert.stdout}\n${revert.stderr}`).toMatch(/modified/i);
      expect(existsSync(claudeMd)).toBe(true);
      expect(readFileSync(claudeMd, "utf-8")).toBe("# I edited this");
    } finally {
      await context.cleanup();
    }
  });
});
