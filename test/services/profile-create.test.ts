import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, spyOn } from "bun:test";
import * as layerModel from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  commitProfileCreate,
  previewProfileCreate,
} from "../../src/services/profile-create.ts";
import { isProfileLayer } from "../../src/constants/profile.ts";
import { getActiveProfileName } from "../../src/services/active-profile.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("profile-create service", () => {
  it("creates a composed profile from selected layers and resources", async () => {
    const context = await createInitializedTestContext("profile-create-compose");
    try {
      const dependency = layerModel.createLayer({ name: "engineering" });
      const resource = createResource({
        type: "skill",
        name: "review",
        description: "Review changes",
        content: "# Review",
        metadata: {},
        source: "manual",
      });

      const preview = await previewProfileCreate({
        source: "compose",
        name: "work",
        layerIds: [dependency.id],
        resourceIds: [resource.id],
      });
      expect(preview).toEqual({
        source: "compose",
        name: "work",
        totalImports: 2,
        conflicts: [],
        warnings: [],
      });

      const result = await commitProfileCreate({
        source: "compose",
        name: "work",
        description: "Work profile",
        layerIds: [dependency.id],
        resourceIds: [resource.id],
      });

      expect(result).toEqual({
        profile: {
          name: "work",
          id: expect.any(String),
          version: "1.0.0",
        },
        imported_count: 2,
        used: false,
      });
      expect(
        layerModel.getLayerResources(result.profile.id).map(({ type, name }) => ({
          type,
          name,
        })),
      ).toEqual([
        { type: "plugin", name: "engineering" },
        { type: "skill", name: "review" },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects a composed profile without selections", async () => {
    const context = await createInitializedTestContext("profile-create-no-selections");
    try {
      await expect(
        commitProfileCreate({ source: "compose", name: "blank" }),
      ).rejects.toThrow("at least one");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects a composed profile whose layer name already exists", async () => {
    const context = await createInitializedTestContext("profile-create-duplicate");
    try {
      const resource = createResource({
        type: "skill",
        name: "review",
        description: "Review changes",
        content: "# Review",
        metadata: {},
        source: "manual",
      });
      layerModel.createLayer({ name: "duplicate" });

      await expect(
        commitProfileCreate({
          source: "compose",
          name: "duplicate",
          resourceIds: [resource.id],
        }),
      ).rejects.toThrow("Layer already exists: duplicate");
    } finally {
      await context.cleanup();
    }
  });

  it("does not promote a non-profile layer created during compose", async () => {
    const context = await createInitializedTestContext("profile-create-compose-race");
    const resource = createResource({
      type: "skill",
      name: "review",
      description: "Review changes",
      content: "# Review",
      metadata: {},
      source: "manual",
    });
    const createLayerDirect = layerModel.createLayer;
    const createSpy = spyOn(layerModel, "createLayer").mockImplementation((input) => {
      createLayerDirect({ name: input.name, description: "Raced layer" });
      return createLayerDirect(input);
    });
    try {
      await expect(
        commitProfileCreate({
          source: "compose",
          name: "raced-profile",
          resourceIds: [resource.id],
        }),
      ).rejects.toThrow("Layer already exists: raced-profile");
      const raced = layerModel.getLayerByName("raced-profile");
      expect(raced?.description).toBe("Raced layer");
      expect(raced ? isProfileLayer(raced) : true).toBe(false);
      expect(layerModel.getLayerResources(raced?.id ?? "")).toHaveLength(0);
    } finally {
      createSpy.mockRestore();
      await context.cleanup();
    }
  });

  it("tags a profile created from a project", async () => {
    const context = await createInitializedTestContext("profile-create-project");
    try {
      writeTextFile(
        join(context.projectDir, "CLAUDE.md"),
        "# Project instructions\n",
      );

      const result = await commitProfileCreate({
        source: "project",
        name: "project-profile",
        projectPath: context.projectDir,
        conflictPolicy: "skip",
        platform: "claude-code",
      });

      expect(result.imported_count).toBeGreaterThan(0);
      const profile = layerModel.getLayer(result.profile.id);
      expect(profile).toBeDefined();
      expect(profile ? isProfileLayer(profile) : false).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects an existing project profile name even with overwrite conflicts", async () => {
    const context = await createInitializedTestContext("profile-create-project-duplicate");
    try {
      const existing = layerModel.createLayer({ name: "project-profile" });
      writeTextFile(
        join(context.projectDir, "CLAUDE.md"),
        "# Project instructions\n",
      );

      await expect(
        commitProfileCreate({
          source: "project",
          name: "project-profile",
          projectPath: context.projectDir,
          conflictPolicy: "overwrite",
          platform: "claude-code",
        }),
      ).rejects.toThrow("Layer already exists: project-profile");
      expect(layerModel.getLayerByName("project-profile")?.id).toBe(existing.id);
    } finally {
      await context.cleanup();
    }
  });

  it("does not delete a layer created during project import", async () => {
    const context = await createInitializedTestContext("profile-create-project-race");
    const createLayerDirect = layerModel.createLayer;
    let racedLayerId: string | undefined;
    const createSpy = spyOn(layerModel, "createLayer").mockImplementation((input) => {
      const raced = createLayerDirect({
        name: input.name,
        description: "Raced project layer",
      });
      racedLayerId = raced.id;
      return createLayerDirect(input);
    });
    try {
      writeTextFile(
        join(context.projectDir, "CLAUDE.md"),
        "# Project instructions\n",
      );

      await expect(
        commitProfileCreate({
          source: "project",
          name: "project-profile",
          projectPath: context.projectDir,
          conflictPolicy: "overwrite",
          platform: "claude-code",
        }),
      ).rejects.toThrow("Layer already exists: project-profile");
      const raced = layerModel.getLayerByName("project-profile");
      expect(raced?.id).toBe(racedLayerId);
      expect(raced?.description).toBe("Raced project layer");
      expect(raced ? isProfileLayer(raced) : true).toBe(false);
    } finally {
      createSpy.mockRestore();
      await context.cleanup();
    }
  });

  it("defers project auto-use to the switch orchestrator", async () => {
    const context = await createInitializedTestContext("profile-create-project-use");
    try {
      const skillPath = join(
        context.projectDir,
        ".claude",
        "skills",
        "research",
        "SKILL.md",
      );
      writeTextFile(
        skillPath,
        "---\nname: research\ndescription: Research\n---\n# Research",
      );

      const result = await commitProfileCreate({
        source: "project",
        name: "project-profile",
        projectPath: context.projectDir,
        conflictPolicy: "skip",
        platform: "claude-code",
        use: true,
      });

      expect(result.used).toBe(false);
      expect(existsSync(skillPath)).toBe(true);
      expect(
        existsSync(
          join(context.homeDir, ".claude", "skills", "research", "SKILL.md"),
        ),
      ).toBe(false);
      expect(getActiveProfileName()).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });
});
