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

  it("getHarnessSettings returns an empty registered set, catalog, and unavailable project without git", async () => {
    const context = await createInitializedTestContext("harness-settings-get");
    try {
      const { getHarnessSettings } = await import(
        "../../src/services/harness-settings.ts"
      );
      const projectDir = mkdtempSync(join(tmpdir(), "ht-hs-nogit-"));
      tempDirs.push(projectDir);

      const payload = getHarnessSettings(projectDir);
      expect(payload.global).toEqual({
        registered_harnesses: [],
      });
      expect(payload.harnesses.some((h) => h.id === "claude-code" && h.supported)).toBe(
        true,
      );
      const claude = payload.harnesses.find((h) => h.id === "claude-code");
      expect(claude?.supports).toContain("skills");
      expect(claude?.supports).toContain("agents");

      const generic = payload.harnesses.find((h) => !h.supported);
      expect(generic).toBeDefined();
      expect(Array.isArray(generic?.supports)).toBe(true);
      expect(payload.project).toEqual({
        available: false,
        override: false,
        reason: "Project has no git origin",
      });
    } finally {
      await context.cleanup();
    }
  });

  it("putHarnessSettings saves global and project override without rematerializing", async () => {
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

      const result = await putHarnessSettings({
        global: { registered_harnesses: ["claude-code", "cursor"] },
        project: {
          path: projectDir,
          override: true,
          registered_harnesses: ["codex", "claude-code"],
          materialization_strategy: "copy",
        },
      });

      expect(getHarnessPreference()?.registered_harnesses).toEqual([
        "claude-code",
        "cursor",
      ]);
      const project = getProjectByOrigin(
        normalizeGitUrl("git@github.com:acme/harnesstap-fixture.git"),
      );
      expect(project).toBeDefined();
      expect(getProjectHarnessConfig(project!.id)).toMatchObject({
        registered_harnesses: ["codex", "claude-code"],
        materialization_strategy: "copy",
      });
      expect(result.project?.override).toBe(true);
      expect("mirror" in result).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("putHarnessSettings clears override", async () => {
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
        registered_harnesses: ["codex"],
      });

      await putHarnessSettings({
        global: { registered_harnesses: ["claude-code"] },
        project: { path: projectDir, override: false },
      });

      expect(getProjectHarnessConfig(project.id)).toBeUndefined();
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
          global: { registered_harnesses: ["not-a-real-harness"] },
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
        registered_harnesses: ["claude-code", "cursor"],
      });

      const projectDir = mkdtempSync(join(tmpdir(), "ht-hs-nogit-put-"));
      tempDirs.push(projectDir);

      await expect(
        putHarnessSettings({
          global: { registered_harnesses: ["codex"] },
          project: {
            path: projectDir,
            override: true,
            registered_harnesses: ["cursor"],
          },
        }),
      ).rejects.toThrow(/git origin/i);

      expect(getHarnessPreference()).toMatchObject({
        registered_harnesses: ["claude-code", "cursor"],
      });
    } finally {
      await context.cleanup();
    }
  });

  it("does not persist global preference when project override registered set is empty", async () => {
    const context = await createInitializedTestContext("harness-settings-noreg-put");
    try {
      const { putHarnessSettings } = await import(
        "../../src/services/harness-settings.ts"
      );
      const { getHarnessPreference, setHarnessPreference } = await import(
        "../../src/models/harness.ts"
      );

      setHarnessPreference({
        registered_harnesses: ["claude-code"],
      });

      const projectDir = mkdtempSync(join(tmpdir(), "ht-hs-noreg-put-"));
      tempDirs.push(projectDir);
      initGitRepo(projectDir);

      await expect(
        putHarnessSettings({
          global: { registered_harnesses: ["codex"] },
          project: {
            path: projectDir,
            override: true,
          },
        }),
      ).rejects.toThrow(/registered_harnesses is required/i);

      expect(getHarnessPreference()?.registered_harnesses).toEqual(["claude-code"]);
    } finally {
      await context.cleanup();
    }
  });
});
