import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  setPluginTags,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { previewProfileApply } from "../../src/services/profile-apply-preview.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("preview-recovery-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("previewProfileApply constraint recovery", () => {
  it("includes recovery_actions when apply resolution fails", async () => {
    const profile = createPlugin({ name: "my-setup" });
    setPluginTags(profile.id, ["profile"]);
    addDependency(profile.id, "design-doc@anthropics", { versionConstraint: "*" });

    const preview = await previewProfileApply({
      profile: "my-setup",
      scope: "home",
    });

    expect(preview.warning).toContain("No local version of design-doc");
    expect(preview.recovery_actions?.[0]?.id).toBe("sync-install");
  });

  it("treats a git-SHA Claude install as present even without plugin.json version", async () => {
    const sha = "4a4211102f36";
    const installPath = join(
      ctx.homeDir,
      ".claude/plugins/cache/teads-plugins/design-doc",
      sha,
    );
    mkdirSync(join(installPath, ".claude-plugin"), { recursive: true });
    mkdirSync(join(installPath, "skills/design-doc"), { recursive: true });
    writeFileSync(
      join(installPath, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "design-doc", description: "Scaffold design documents" }),
    );
    writeFileSync(
      join(installPath, "skills/design-doc/SKILL.md"),
      "---\nname: design-doc\ndescription: Write design docs\n---\n\n# Design doc\n",
    );
    mkdirSync(join(ctx.homeDir, ".claude/plugins"), { recursive: true });
    writeFileSync(
      join(ctx.homeDir, ".claude/plugins/installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "design-doc@teads-plugins": [
            {
              scope: "user",
              installPath,
              version: sha,
              gitCommitSha: "4a4211102f3625cad9c344aa5fabe2b6f2a9a42d",
            },
          ],
        },
      }),
    );

    const profile = createPlugin({ name: "Teads (Default)", version: "1.0.1" });
    setPluginTags(profile.id, ["profile"]);
    addDependency(profile.id, "design-doc@teads-plugins", { versionConstraint: "*" });

    const preview = await previewProfileApply({
      profile: "Teads (Default)",
      scope: "home",
    });

    expect(preview.warning).toBeUndefined();
    expect(getPluginByName("design-doc", sha)).toBeDefined();
  });

  it("includes override-resource actions when apply hits a singleton conflict", async () => {
    const left = createPlugin({ name: "left" });
    addResourceToPlugin(
      left.id,
      createResource({
        type: "instruction",
        name: "context",
        description: "",
        content: "LEFT",
        metadata: {},
        source: "test",
        namespace: "left",
      }).id,
    );
    const right = createPlugin({ name: "right" });
    addResourceToPlugin(
      right.id,
      createResource({
        type: "instruction",
        name: "context",
        description: "",
        content: "RIGHT",
        metadata: {},
        source: "test",
        namespace: "right",
      }).id,
    );
    const profile = createPlugin({ name: "my-setup" });
    setPluginTags(profile.id, ["profile"]);
    addDependency(profile.id, "left", { versionConstraint: "*" });
    addDependency(profile.id, "right", { versionConstraint: "*" });

    const preview = await previewProfileApply({
      profile: "my-setup",
      scope: "home",
    });

    expect(preview.warning).toContain("conflicting instruction:context");
    expect(preview.recovery_actions?.map((action) => action.id)).toEqual([
      "override-resource",
      "override-resource",
    ]);
  });

  it("includes tag-as-profile when the plugin is not a profile", async () => {
    createPlugin({ name: "focus" });

    const preview = await previewProfileApply({
      profile: "focus",
      scope: "home",
    });

    expect(preview.warning).toContain("not tagged as a profile");
    expect(preview.recovery_actions?.[0]).toMatchObject({
      id: "tag-as-profile",
      pluginName: "focus",
    });
  });
});
