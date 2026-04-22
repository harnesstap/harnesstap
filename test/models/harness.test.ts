import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("harness model", () => {
  it("returns undefined when no harness preference is set", async () => {
    const context = await createInitializedTestContext("harness-undefined");

    try {
      const harness = await import("../../src/models/harness.ts");

      expect(harness.getHarnessPreference()).toBeUndefined();
      expect(harness.getProjectHarnessConfig("nonexistent-id")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("sets and retrieves a harness preference", async () => {
    const context = await createInitializedTestContext("harness-preference");

    try {
      const harness = await import("../../src/models/harness.ts");

      const preference = harness.setHarnessPreference({
        main_harness: "claude-code",
        alias_harnesses: ["cursor", "copilot-cli"],
      });

      expect(preference.main_harness).toBe("claude-code");
      expect(preference.alias_harnesses).toEqual(["cursor", "copilot-cli"]);
      expect(preference.updated_at).toBeDefined();

      const retrieved = harness.getHarnessPreference();
      expect(retrieved).toEqual({
        main_harness: "claude-code",
        alias_harnesses: ["cursor", "copilot-cli"],
        updated_at: preference.updated_at,
      });
    } finally {
      await context.cleanup();
    }
  });

  it("normalizes alias_harnesses by removing duplicates and excluding main", async () => {
    const context = await createInitializedTestContext("harness-normalize");

    try {
      const harness = await import("../../src/models/harness.ts");

      const preference = harness.setHarnessPreference({
        main_harness: "cursor",
        alias_harnesses: ["cursor", "cursor", "codex", "copilot-cli", "cursor"],
      });

      expect(preference.alias_harnesses).toEqual(["codex", "copilot-cli"]);
    } finally {
      await context.cleanup();
    }
  });

  it("updates an existing harness preference", async () => {
    const context = await createInitializedTestContext("harness-update");

    try {
      const harness = await import("../../src/models/harness.ts");

      harness.setHarnessPreference({
        main_harness: "claude-code",
        alias_harnesses: ["cursor"],
      });

      const updated = harness.setHarnessPreference({
        main_harness: "cursor",
        alias_harnesses: ["claude-code", "codex"],
      });

      expect(updated.main_harness).toBe("cursor");
      expect(updated.alias_harnesses).toEqual(["claude-code", "codex"]);

      const retrieved = harness.getHarnessPreference();
      expect(retrieved?.main_harness).toBe("cursor");
      expect(retrieved?.alias_harnesses).toEqual(["claude-code", "codex"]);
    } finally {
      await context.cleanup();
    }
  });

  it("sets and retrieves project harness config", async () => {
    const context = await createInitializedTestContext("harness-project-config");

    try {
      const harness = await import("../../src/models/harness.ts");
      const projectModel = await import("../../src/models/project.ts");

      const project = projectModel.createProject({
        git_origin: "git@github.com:test/harness-config.git",
        name: "test/harness-config",
        local_path: context.projectDir,
      });

      const config = harness.setProjectHarnessConfig({
        project_id: project.id,
        main_harness: "claude-code",
        alias_harnesses: ["cursor"],
        materialization_strategy: "symlink-preferred",
      });

      expect(config.project_id).toBe(project.id);
      expect(config.main_harness).toBe("claude-code");
      expect(config.alias_harnesses).toEqual(["cursor"]);
      expect(config.materialization_strategy).toBe("symlink-preferred");

      const retrieved = harness.getProjectHarnessConfig(project.id);
      expect(retrieved).toEqual({
        project_id: project.id,
        main_harness: "claude-code",
        alias_harnesses: ["cursor"],
        materialization_strategy: "symlink-preferred",
        updated_at: config.updated_at,
      });
    } finally {
      await context.cleanup();
    }
  });

  it("defaults materialization_strategy to symlink-preferred", async () => {
    const context = await createInitializedTestContext("harness-default-strategy");

    try {
      const harness = await import("../../src/models/harness.ts");
      const projectModel = await import("../../src/models/project.ts");

      const project = projectModel.createProject({
        git_origin: "git@github.com:test/default-strategy.git",
        name: "test/default-strategy",
        local_path: context.projectDir,
      });

      const config = harness.setProjectHarnessConfig({
        project_id: project.id,
        main_harness: "claude-code",
      });

      expect(config.materialization_strategy).toBe("symlink-preferred");
    } finally {
      await context.cleanup();
    }
  });

  it("stores copy strategy when explicitly set", async () => {
    const context = await createInitializedTestContext("harness-copy-strategy");

    try {
      const harness = await import("../../src/models/harness.ts");
      const projectModel = await import("../../src/models/project.ts");

      const project = projectModel.createProject({
        git_origin: "git@github.com:test/copy-strategy.git",
        name: "test/copy-strategy",
        local_path: context.projectDir,
      });

      const config = harness.setProjectHarnessConfig({
        project_id: project.id,
        main_harness: "claude-code",
        materialization_strategy: "copy",
      });

      expect(config.materialization_strategy).toBe("copy");
    } finally {
      await context.cleanup();
    }
  });

  it("updates existing project harness config", async () => {
    const context = await createInitializedTestContext("harness-project-update");

    try {
      const harness = await import("../../src/models/harness.ts");
      const projectModel = await import("../../src/models/project.ts");

      const project = projectModel.createProject({
        git_origin: "git@github.com:test/project-update.git",
        name: "test/project-update",
        local_path: context.projectDir,
      });

      harness.setProjectHarnessConfig({
        project_id: project.id,
        main_harness: "claude-code",
        materialization_strategy: "symlink-preferred",
      });

      const updated = harness.setProjectHarnessConfig({
        project_id: project.id,
        main_harness: "cursor",
        alias_harnesses: ["codex"],
        materialization_strategy: "copy",
      });

      expect(updated.main_harness).toBe("cursor");
      expect(updated.alias_harnesses).toEqual(["codex"]);
      expect(updated.materialization_strategy).toBe("copy");
    } finally {
      await context.cleanup();
    }
  });

  it("normalizes project harness config aliases", async () => {
    const context = await createInitializedTestContext("harness-project-normalize");

    try {
      const harness = await import("../../src/models/harness.ts");
      const projectModel = await import("../../src/models/project.ts");

      const project = projectModel.createProject({
        git_origin: "git@github.com:test/project-normalize.git",
        name: "test/project-normalize",
        local_path: context.projectDir,
      });

      const config = harness.setProjectHarnessConfig({
        project_id: project.id,
        main_harness: "claude-code",
        alias_harnesses: ["cursor", "claude-code", "codex", "cursor"],
      });

      expect(config.alias_harnesses).toEqual(["cursor", "codex"]);
    } finally {
      await context.cleanup();
    }
  });
});
