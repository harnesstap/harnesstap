import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";

describe("harness-settings service", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("getHarnessSettings returns global nulls, catalog with supported flags, and unavailable project without git", async () => {
    const context = await createInitializedTestContext("harness-settings-get");
    try {
      const { getHarnessSettings } = await import(
        "../../src/services/harness-settings.ts"
      );
      const projectDir = mkdtempSync(join(tmpdir(), "ht-hs-nogit-"));
      tempDirs.push(projectDir);

      const payload = getHarnessSettings(projectDir);
      expect(payload.global).toEqual({
        main_harness: null,
        alias_harnesses: [],
      });
      expect(payload.harnesses.some((h) => h.id === "claude-code" && h.supported)).toBe(
        true,
      );
      expect(payload.project).toEqual({
        available: false,
        override: false,
        reason: "Project has no git origin",
      });
    } finally {
      await context.cleanup();
    }
  });

  it("putHarnessSettings saves global and mirrors when project override is on", async () => {
    const context = await createInitializedTestContext("harness-settings-put");
    try {
      const { putHarnessSettings } = await import(
        "../../src/services/harness-settings.ts"
      );
      const { getHarnessPreference, getProjectHarnessConfig } = await import(
        "../../src/models/harness.ts"
      );
      const { getProjectByOrigin } = await import("../../src/models/project.ts");
      const { normalizeGitUrl } = await import("../../src/services/git.ts");

      const projectDir = mkdtempSync(join(tmpdir(), "ht-hs-put-"));
      tempDirs.push(projectDir);
      initGitRepo(projectDir);

      let syncCalls = 0;
      const result = await putHarnessSettings(
        {
          global: {
            main_harness: "claude-code",
            alias_harnesses: ["cursor"],
          },
          project: {
            path: projectDir,
            override: true,
            main_harness: "codex",
            alias_harnesses: ["claude-code"],
            materialization_strategy: "copy",
          },
        },
        {
          syncProject: async (opts) => {
            syncCalls += 1;
            expect(opts.projectRoot).toBe(projectDir);
            expect(opts.forceShiftReference).toBeUndefined();
            return {
              main_harness: "codex",
              alias_harnesses: ["claude-code"],
              materialization_strategy: "copy" as const,
              platforms_synced: ["claude-code"],
              files_written: 2,
              surface_warnings: [],
            };
          },
        },
      );

      expect(syncCalls).toBe(1);
      expect(getHarnessPreference()?.main_harness).toBe("claude-code");
      const project = getProjectByOrigin(
        normalizeGitUrl("git@github.com:acme/harnesstap-fixture.git"),
      );
      expect(project).toBeDefined();
      expect(getProjectHarnessConfig(project!.id)).toMatchObject({
        main_harness: "codex",
        alias_harnesses: ["claude-code"],
        materialization_strategy: "copy",
      });
      expect(result.mirror?.files_written).toBe(2);
      expect(result.project?.override).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("putHarnessSettings clears override without calling sync", async () => {
    const context = await createInitializedTestContext("harness-settings-clear");
    try {
      const { putHarnessSettings } = await import(
        "../../src/services/harness-settings.ts"
      );
      const { setProjectHarnessConfig, getProjectHarnessConfig } = await import(
        "../../src/models/harness.ts"
      );
      const { upsertProject } = await import("../../src/models/project.ts");
      const { normalizeGitUrl } = await import("../../src/services/git.ts");

      const projectDir = mkdtempSync(join(tmpdir(), "ht-hs-clear-"));
      tempDirs.push(projectDir);
      initGitRepo(projectDir);
      const project = upsertProject({
        git_origin: normalizeGitUrl(
          "git@github.com:acme/harnesstap-fixture.git",
        ),
        name: "fixture",
        local_path: projectDir,
      });
      setProjectHarnessConfig({
        project_id: project.id,
        main_harness: "codex",
        alias_harnesses: [],
      });

      let syncCalls = 0;
      await putHarnessSettings(
        {
          global: { main_harness: "claude-code", alias_harnesses: [] },
          project: { path: projectDir, override: false },
        },
        {
          syncProject: async () => {
            syncCalls += 1;
            throw new Error("should not sync");
          },
        },
      );

      expect(syncCalls).toBe(0);
      expect(getProjectHarnessConfig(project.id)).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("putHarnessSettings keeps prefs when sync throws and sets mirror_error", async () => {
    const context = await createInitializedTestContext("harness-settings-mirror-err");
    try {
      const { putHarnessSettings } = await import(
        "../../src/services/harness-settings.ts"
      );
      const { getProjectHarnessConfig } = await import(
        "../../src/models/harness.ts"
      );
      const { getProjectByOrigin } = await import("../../src/models/project.ts");
      const { normalizeGitUrl } = await import("../../src/services/git.ts");

      const projectDir = mkdtempSync(join(tmpdir(), "ht-hs-merr-"));
      tempDirs.push(projectDir);
      initGitRepo(projectDir);

      const result = await putHarnessSettings(
        {
          global: { main_harness: "claude-code", alias_harnesses: [] },
          project: {
            path: projectDir,
            override: true,
            main_harness: "cursor",
            alias_harnesses: [],
          },
        },
        {
          syncProject: async () => {
            throw new Error("mirror boom");
          },
        },
      );

      const project = getProjectByOrigin(
        normalizeGitUrl("git@github.com:acme/harnesstap-fixture.git"),
      );
      expect(getProjectHarnessConfig(project!.id)?.main_harness).toBe("cursor");
      expect(result.mirror_error).toBe("mirror boom");
      expect(result.mirror).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("rejects unknown harness slugs", async () => {
    const context = await createInitializedTestContext("harness-settings-bad");
    try {
      const { putHarnessSettings } = await import(
        "../../src/services/harness-settings.ts"
      );
      await expect(
        putHarnessSettings({
          global: { main_harness: "not-a-real-harness", alias_harnesses: [] },
        }),
      ).rejects.toThrow(/unknown harness/i);
    } finally {
      await context.cleanup();
    }
  });

  it("does not persist global preference when project path lacks git origin", async () => {
    const context = await createInitializedTestContext("harness-settings-nogit-put");
    try {
      const { putHarnessSettings } = await import(
        "../../src/services/harness-settings.ts"
      );
      const { getHarnessPreference, setHarnessPreference } = await import(
        "../../src/models/harness.ts"
      );

      setHarnessPreference({
        main_harness: "claude-code",
        alias_harnesses: ["cursor"],
      });
      expect(getHarnessPreference()).toMatchObject({
        main_harness: "claude-code",
        alias_harnesses: ["cursor"],
      });

      const projectDir = mkdtempSync(join(tmpdir(), "ht-hs-nogit-put-"));
      tempDirs.push(projectDir);

      await expect(
        putHarnessSettings({
          global: {
            main_harness: "codex",
            alias_harnesses: [],
          },
          project: {
            path: projectDir,
            override: true,
            main_harness: "cursor",
            alias_harnesses: [],
          },
        }),
      ).rejects.toThrow(/git origin/i);

      expect(getHarnessPreference()).toMatchObject({
        main_harness: "claude-code",
        alias_harnesses: ["cursor"],
      });
    } finally {
      await context.cleanup();
    }
  });

  it("does not persist global preference when project override main is missing", async () => {
    const context = await createInitializedTestContext("harness-settings-nomain-put");
    try {
      const { putHarnessSettings } = await import(
        "../../src/services/harness-settings.ts"
      );
      const { getHarnessPreference, setHarnessPreference } = await import(
        "../../src/models/harness.ts"
      );

      setHarnessPreference({
        main_harness: "claude-code",
        alias_harnesses: [],
      });

      const projectDir = mkdtempSync(join(tmpdir(), "ht-hs-nomain-put-"));
      tempDirs.push(projectDir);
      initGitRepo(projectDir);

      await expect(
        putHarnessSettings({
          global: {
            main_harness: "codex",
            alias_harnesses: [],
          },
          project: {
            path: projectDir,
            override: true,
          },
        }),
      ).rejects.toThrow(/main_harness is required/i);

      expect(getHarnessPreference()?.main_harness).toBe("claude-code");
    } finally {
      await context.cleanup();
    }
  });
});