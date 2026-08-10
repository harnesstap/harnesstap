import { describe, expect, it, spyOn } from "bun:test";
import * as pluginModel from "../../src/models/plugin-model.ts";
import {
  createResource,
  listResources,
} from "../../src/models/resource.ts";
import {
  createProfileFromHome,
  previewProfileFromHome,
} from "../../src/services/profile-from-home.ts";
import { isProfilePlugin } from "../../src/constants/profile.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

function writeHomeSkill(
  homeRoot: string,
  name = "research",
  content = "# Research",
): void {
  writeTextFile(
    `${homeRoot}/.claude/skills/${name}/SKILL.md`,
    `---\nname: ${name}\ndescription: Home helper\n---\n${content}`,
  );
}

function createExistingSkill(name: string, content: string) {
  return createResource({
    type: "skill",
    name,
    description: "Existing helper",
    content,
    metadata: {},
    source: "manual",
  });
}

describe("profile-from-home service", () => {
  it("previews a home scan without creating a plugin", async () => {
    const context = await createInitializedTestContext("profile-from-home-preview");
    try {
      writeHomeSkill(context.homeDir);

      const preview = await previewProfileFromHome({
        homeRoot: context.homeDir,
        platform: "claude-code",
      });

      expect(preview).toEqual({
        totalImports: 1,
        platformIds: ["claude-code"],
        conflicts: [],
      });
      expect(pluginModel.getPluginByName("from-home")).toBeUndefined();
      expect(listResources()).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("warns when the home scan is empty", async () => {
    const context = await createInitializedTestContext("profile-from-home-empty");
    try {
      const preview = await previewProfileFromHome({
        homeRoot: context.homeDir,
      });

      expect(preview.totalImports).toBe(0);
      expect(preview.platformIds).toEqual([]);
      expect(preview.conflicts).toEqual([]);
      expect(preview.warning).toBeTruthy();
    } finally {
      await context.cleanup();
    }
  });

  it("reports conflicting library resources without modifying them", async () => {
    const context = await createInitializedTestContext("profile-from-home-conflict");
    try {
      createExistingSkill("research", "# Existing");
      writeHomeSkill(context.homeDir, "research", "# Incoming");

      const preview = await previewProfileFromHome({
        homeRoot: context.homeDir,
        platform: "claude-code",
      });

      expect(preview.conflicts).toEqual([
        {
          type: "skill",
          name: "research",
          namespace: null,
        },
      ]);
      expect(listResources()[0]?.content).toBe("# Existing");
    } finally {
      await context.cleanup();
    }
  });

  it("creates a profile plugin containing scanned home resources", async () => {
    const context = await createInitializedTestContext("profile-from-home-create");
    try {
      writeHomeSkill(context.homeDir);

      const result = await createProfileFromHome({
        name: "from-home",
        description: "Imported home profile",
        conflictPolicy: "skip",
        homeRoot: context.homeDir,
        platform: "claude-code",
      });

      expect(isProfilePlugin(result.plugin)).toBe(true);
      expect(result.plugin).toMatchObject({
        name: "from-home",
        description: "Imported home profile",
      });
      expect(result.imported_count).toBe(1);
      expect(result.resources).toHaveLength(1);
      expect(pluginModel.getPluginResources(result.plugin.id).map((resource) => resource.name)).toEqual([
        "research",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("attaches an existing resource when conflicts are skipped", async () => {
    const context = await createInitializedTestContext("profile-from-home-skip");
    try {
      const existing = createExistingSkill("research", "# Existing");
      writeHomeSkill(context.homeDir, "research", "# Incoming");

      const result = await createProfileFromHome({
        name: "skip-profile",
        conflictPolicy: "skip",
        homeRoot: context.homeDir,
        platform: "claude-code",
      });

      expect(result.resources.map((resource) => resource.id)).toEqual([existing.id]);
      expect(pluginModel.getPluginResources(result.plugin.id)[0]?.content).toBe("# Existing");
    } finally {
      await context.cleanup();
    }
  });

  it("updates an existing resource when conflicts are overwritten", async () => {
    const context = await createInitializedTestContext("profile-from-home-overwrite");
    try {
      const existing = createExistingSkill("research", "# Existing");
      writeHomeSkill(context.homeDir, "research", "# Incoming");

      const result = await createProfileFromHome({
        name: "overwrite-profile",
        conflictPolicy: "overwrite",
        homeRoot: context.homeDir,
        platform: "claude-code",
      });

      expect(result.resources.map((resource) => resource.id)).toEqual([existing.id]);
      expect(result.resources[0]?.content).toBe("# Incoming");
      expect(pluginModel.getPluginResources(result.plugin.id)[0]?.content).toBe("# Incoming");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects duplicate names before persisting scanned resources", async () => {
    const context = await createInitializedTestContext("profile-from-home-duplicate");
    try {
      pluginModel.createPlugin({ name: "duplicate" });
      writeHomeSkill(context.homeDir);

      await expect(
        createProfileFromHome({
          name: "duplicate",
          conflictPolicy: "skip",
          homeRoot: context.homeDir,
          platform: "claude-code",
        }),
      ).rejects.toThrow("Plugin already exists: duplicate");
      expect(listResources()).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("does not promote a non-profile plugin created during the home scan", async () => {
    const context = await createInitializedTestContext("profile-from-home-race");
    const createPluginDirect = pluginModel.createPlugin;
    const createSpy = spyOn(
      pluginModel,
      "createPlugin",
    ).mockImplementation((input) => {
      createPluginDirect({ name: input.name, description: "Raced plugin" });
      return createPluginDirect(input);
    });
    try {
      writeHomeSkill(context.homeDir);

      await expect(
        createProfileFromHome({
          name: "raced-profile",
          conflictPolicy: "skip",
          homeRoot: context.homeDir,
          platform: "claude-code",
        }),
      ).rejects.toThrow("Plugin already exists: raced-profile");
      const raced = pluginModel.getPluginByName("raced-profile");
      expect(raced?.description).toBe("Raced plugin");
      expect(raced ? isProfilePlugin(raced) : true).toBe(false);
      expect(pluginModel.getPluginResources(raced?.id ?? "")).toHaveLength(0);
    } finally {
      createSpy.mockRestore();
      await context.cleanup();
    }
  });
});
