import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { addResourceToPlugin, createPlugin, getPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { clearActiveProfileName } from "../../src/services/active-profile.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

describe("CLI profile preview", () => {
  it("prints Contents, Files, Untracked, and Recovery headings without a write-plan", async () => {
    const context = await createTestContext("cli-profile-preview-human");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "work-guide",
        description: "",
        content: "# work",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, resource.id);

      const result = await runCli(["profile", "preview", "work", "--harness", "claude-code"]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("Contents");
      expect(result.stdout).toContain("Files");
      expect(result.stdout).not.toContain("Written");
      expect(result.stdout).not.toContain("Skipped");
      expect(result.stdout).toMatch(/plugin work@/i);
      expect(result.stdout).toContain("instruction:work-guide");
    } finally {
      await context.cleanup();
    }
  });

  it("prints parseable ProfileApplyPreview JSON for a single scope", async () => {
    const context = await createTestContext("cli-profile-preview-json");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);

      const result = await runCli([
        "profile",
        "preview",
        "work",
        "--format",
        "json",
        "--harness",
        "claude-code",
      ]);

      expect(result.exitCode).toBeUndefined();
      const payload = JSON.parse(result.stdout) as {
        profile: string;
        scope: string;
        contents: unknown;
        files: { expected_count: number; changes: unknown[]; root_path: string };
        not_staged: unknown[];
      };
      expect(payload.profile).toBe("work");
      expect(payload.scope).toBe("home");
      expect(payload.contents).toBeTruthy();
      expect(payload.files.root_path).toBe(context.homeDir);
      expect(Array.isArray(payload.files.changes)).toBe(true);
      expect(Array.isArray(payload.not_staged)).toBe(true);
      expect(payload).not.toHaveProperty("home");
      expect(payload).not.toHaveProperty("project");
    } finally {
      await context.cleanup();
    }
  });

  it("errors when name is missing, no active profile, and --no-interactive", async () => {
    const context = await createTestContext("cli-profile-preview-missing-name");
    try {
      await runCli(["init"]);
      clearActiveProfileName();
      const result = await runCli(["profile", "preview", "--no-interactive"], { isTTY: false });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing required argument 'name'");
    } finally {
      await context.cleanup();
    }
  });

  it("errors on invalid --scope", async () => {
    const context = await createTestContext("cli-profile-preview-bad-scope");
    try {
      await runCli(["init"]);
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const result = await runCli(["profile", "preview", "work", "--scope", "galaxy"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/Invalid --scope value/i);
    } finally {
      await context.cleanup();
    }
  });

  it("JSON project scope uses the given --project path", async () => {
    const context = await createTestContext("cli-profile-preview-project");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);

      const result = await runCli([
        "profile",
        "preview",
        "work",
        "--scope",
        "project",
        "--project",
        context.projectDir,
        "--format",
        "json",
      ]);

      expect(result.exitCode).toBeUndefined();
      const payload = JSON.parse(result.stdout) as {
        scope: string;
        files: { root_path: string };
      };
      expect(payload.scope).toBe("project");
      expect(resolve(payload.files.root_path)).toBe(resolve(context.projectDir));
    } finally {
      await context.cleanup();
    }
  });

  it("JSON --scope both wraps home and project previews", async () => {
    const context = await createTestContext("cli-profile-preview-both");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);

      const json = await runCli([
        "profile",
        "preview",
        "work",
        "--scope",
        "both",
        "--project",
        context.projectDir,
        "--format",
        "json",
        "--harness",
        "claude-code",
      ]);
      expect(json.exitCode).toBeUndefined();
      const payload = JSON.parse(json.stdout) as {
        home: { scope: string };
        project: { scope: string };
      };
      expect(payload.home.scope).toBe("home");
      expect(payload.project.scope).toBe("project");

      const human = await runCli([
        "profile",
        "preview",
        "work",
        "--scope",
        "both",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);
      expect(human.stdout).toContain("Home");
      expect(human.stdout).toContain("Project");
      expect(human.stdout).toContain("Contents");
      expect(human.stdout).toContain("Files");
    } finally {
      await context.cleanup();
    }
  });

  it("lists recovery actions, exits 0, and does not mutate the library", async () => {
    const context = await createTestContext("cli-profile-preview-recovery");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const profile = createPlugin({ name: "my-setup" });
      setPluginTags(profile.id, ["profile"]);
      addDependency(profile.id, "design-doc@anthropics", { versionConstraint: "*" });

      const before = JSON.stringify(getPlugin("my-setup"));

      const result = await runCli([
        "profile",
        "preview",
        "my-setup",
        "--format",
        "json",
        "--harness",
        "claude-code",
      ]);

      expect(result.exitCode).toBeUndefined();
      const payload = JSON.parse(result.stdout) as {
        warning?: string;
        recovery_actions?: Array<{ id: string; label: string }>;
      };
      expect(payload.warning).toContain("No local version of design-doc");
      expect(payload.recovery_actions?.[0]?.id).toBe("sync-install");
      expect(payload.recovery_actions?.[0]?.label).toBeTruthy();

      const after = JSON.stringify(getPlugin("my-setup"));
      expect(after).toBe(before);

      const human = await runCli([
        "profile",
        "preview",
        "my-setup",
        "--harness",
        "claude-code",
      ]);
      expect(human.exitCode).toBeUndefined();
      expect(human.stdout).toContain("Recovery");
      expect(human.stdout).toContain("sync-install");
      expect(human.stdout).not.toContain("Written");
    } finally {
      await context.cleanup();
    }
  });

  it("does not write harness files", async () => {
    const context = await createTestContext("cli-profile-preview-readonly");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "work-guide",
        description: "",
        content: "# work",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, resource.id);
      await runCli(["profile", "use", "work", "--harness", "claude-code"]);

      const claudeMd = join(context.homeDir, "CLAUDE.md");
      const existed = existsSync(claudeMd);
      const beforeContent = existed ? readFileSync(claudeMd, "utf-8") : "";
      const beforeMtime = existed ? statSync(claudeMd).mtimeMs : 0;

      await runCli(["profile", "preview", "work", "--harness", "claude-code"]);

      if (existed) {
        expect(readFileSync(claudeMd, "utf-8")).toBe(beforeContent);
        expect(statSync(claudeMd).mtimeMs).toBe(beforeMtime);
      } else {
        expect(existsSync(claudeMd)).toBe(false);
      }
    } finally {
      await context.cleanup();
    }
  });

  it("profile use --dry-run still prints the write-plan, not preview sections", async () => {
    const context = await createTestContext("cli-profile-preview-dry-run-regression");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "work-guide",
        description: "",
        content: "# work",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, resource.id);

      const dryRun = await runCli([
        "profile",
        "use",
        "work",
        "--dry-run",
        "--harness",
        "claude-code",
      ]);
      expect(dryRun.stdout).toContain("Applied profile");
      expect(dryRun.stdout).toContain("dry run");
      expect(dryRun.stdout).not.toContain("Untracked");
      expect(dryRun.stdout).not.toMatch(/^Contents$/m);
    } finally {
      await context.cleanup();
    }
  });
});
