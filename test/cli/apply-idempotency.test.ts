import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { generateFiles } from "../../src/services/applier.ts";
import {
  flattenUniqueFiles,
  skillPlacementsFromPaths,
} from "../../src/services/shared-emit-paths.ts";
import { readLockfile } from "../../src/services/lockfile.ts";

const SKILL_BODY = `---
name: big-review
description: Thorough review
---
# Big Review
END-OF-BIG-REVIEW-MARKER
`;

describe("project apply idempotency (W1-1)", () => {
  it("applies twice as a no-op and stays stable after .agents/skills appears", async () => {
    const context = await createTestContext("cli-apply-idempotent");
    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-apply-idempotent.git");
      await runCli(["init", "--harnesses", "claude-code,cursor,opencode"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "review-kit" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "big-review",
          content: SKILL_BODY,
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const harnesses = ["claude-code", "cursor", "opencode"];
      const first = await runCli([
        "apply",
        "review-kit",
        "--project",
        context.projectDir,
        "--harness",
        harnesses.join(","),
      ]);
      expect(first.exitCode ?? 0).toBe(0);
      const opencodeSkill = join(context.projectDir, ".opencode/skills/big-review/SKILL.md");
      expect(existsSync(opencodeSkill)).toBe(true);
      const firstBody = readFileSync(opencodeSkill, "utf-8");
      expect(firstBody).toContain("END-OF-BIG-REVIEW-MARKER");

      const lock = readLockfile(context.projectDir);
      expect(lock?.deployed_file_hashes?.[".opencode/skills/big-review/SKILL.md"]).toBeDefined();

      const second = await runCli([
        "apply",
        "review-kit",
        "--project",
        context.projectDir,
        "--harness",
        harnesses.join(","),
      ]);
      expect(second.exitCode ?? 0).toBe(0);
      expect(second.stderr + second.stdout).not.toMatch(/missing .*local_deployed_file_hashes/);
      expect(existsSync(opencodeSkill)).toBe(true);
      expect(readFileSync(opencodeSkill, "utf-8")).toBe(firstBody);

      mkdirSync(join(context.projectDir, ".agents/skills"), { recursive: true });
      const third = await runCli([
        "apply",
        "review-kit",
        "--project",
        context.projectDir,
        "--harness",
        harnesses.join(","),
      ]);
      expect(third.exitCode ?? 0).toBe(0);
      expect(existsSync(opencodeSkill)).toBe(true);
      expect(readFileSync(opencodeSkill, "utf-8")).toBe(firstBody);
    } finally {
      await context.cleanup();
    }
  });

  it("produces the same plan on consecutive generateFiles calls after a lock exists", async () => {
    const context = await createTestContext("cli-apply-plan-stable");
    try {
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-plan-stable.git");
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const { initializeSchema } = await import("../../src/db/schema.ts");
      const { getDb } = await import("../../src/db/connection.ts");
      initializeSchema(getDb());

      const plugin = pluginModel.createPlugin({ name: "review-kit" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "big-review",
          content: SKILL_BODY,
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);
      const resources = [resource];
      const platforms = ["cursor", "opencode"];

      const first = await generateFiles(resources, platforms, context.projectDir, {
        target: "project",
      });
      const firstPaths = flattenUniqueFiles(first).map((file) => file.path).sort();
      expect(firstPaths).toContain(".opencode/skills/big-review/SKILL.md");

      const second = await generateFiles(resources, platforms, context.projectDir, {
        target: "project",
        previousManagedPlacements: skillPlacementsFromPaths(firstPaths),
      });
      mkdirSync(join(context.projectDir, ".agents/skills/extra"), { recursive: true });
      writeFileSync(join(context.projectDir, ".agents/skills/extra/.keep"), "");
      const third = await generateFiles(resources, platforms, context.projectDir, {
        target: "project",
        previousManagedPlacements: skillPlacementsFromPaths(firstPaths),
      });
      expect(flattenUniqueFiles(second).map((file) => file.path).sort()).toEqual(firstPaths);
      expect(flattenUniqueFiles(third).map((file) => file.path).sort()).toEqual(firstPaths);
    } finally {
      await context.cleanup();
    }
  });
});
