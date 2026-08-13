import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginResources,
  setPluginTags,
} from "../../src/models/plugin-model.ts";
import { createResource, getResource } from "../../src/models/resource.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";

const SKILL_REL = ".claude/skills/manual-skill/SKILL.md";

function writeUntrackedSkill(homeDir: string, name: string, body: string): void {
  mkdirSync(join(homeDir, ".claude", "skills", name), { recursive: true });
  writeFileSync(
    join(homeDir, ".claude", "skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name}\n---\n\n${body}`,
    "utf-8",
  );
}

async function seedProfileWork(): Promise<ReturnType<typeof createPlugin>> {
  const profile = createPlugin({ name: "work" });
  setPluginTags(profile.id, ["profile"]);
  return profile;
}

describe("CLI profile live files", () => {
  it("lists the six live-file subcommands on profile --help", async () => {
    const context = await createTestContext("cli-live-help");
    try {
      await runCli(["init"]);
      const help = await runCli(["profile", "--help"]);
      expect(help.stdout).toContain("add-resource");
      expect(help.stdout).toContain("add-all-resources");
      expect(help.stdout).toContain("commit-resource");
      expect(help.stdout).toContain("remove-resource");
      expect(help.stdout).toContain("restore-file");
      expect(help.stdout).toContain("file-diff");
    } finally {
      await context.cleanup();
    }
  });

  it("adds one untracked resource (human and json)", async () => {
    const context = await createTestContext("cli-live-add-one");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const profile = await seedProfileWork();
      writeUntrackedSkill(context.homeDir, "manual-skill", "# manual");

      const human = await runCli([
        "profile", "add-resource", "work",
        "--selector", "skill:manual-skill",
        "--scope", "home",
        "--harness", "claude-code",
      ]);
      expect(human.exitCode === undefined || human.exitCode === 0).toBe(true);
      expect(human.stdout).toContain("Added skill:manual-skill to profile work.");
      expect(getPluginResources(profile.id).some((row) => row.name === "manual-skill")).toBe(true);

      writeUntrackedSkill(context.homeDir, "other-skill", "# other");
      const json = await runCli([
        "profile", "add-resource", "work",
        "--selector", "skill:other-skill",
        "--scope", "home",
        "--harness", "claude-code",
        "--format", "json",
      ]);
      const body = JSON.parse(json.stdout);
      expect(body.resource).toEqual(expect.objectContaining({
        type: "skill",
        name: "other-skill",
      }));
    } finally {
      await context.cleanup();
    }
  });

  it("adds all untracked resources and errors on empty set", async () => {
    const context = await createTestContext("cli-live-add-all");
    try {
      await runCli(["init", "--main", "claude-code"]);
      await seedProfileWork();
      writeUntrackedSkill(context.homeDir, "alpha-skill", "# a");
      writeUntrackedSkill(context.homeDir, "beta-skill", "# b");

      const human = await runCli([
        "profile", "add-all-resources", "work",
        "--scope", "home",
        "--harness", "claude-code",
      ]);
      expect(human.stdout).toMatch(/Added \d+ resources to profile work\./);

      const empty = await runCli([
        "profile", "add-all-resources", "work",
        "--scope", "home",
        "--harness", "claude-code",
      ]);
      expect(empty.exitCode).toBe(1);
      expect(empty.stderr).toContain("No untracked resources to add to profile.");
    } finally {
      await context.cleanup();
    }
  });

  it("requires --project when --scope project", async () => {
    const context = await createTestContext("cli-live-project-required");
    try {
      await runCli(["init"]);
      await seedProfileWork();
      const result = await runCli([
        "profile", "add-resource", "work",
        "--selector", "skill:foo",
        "--scope", "project",
      ]);
      expect(result.exitCode).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain("project");
    } finally {
      await context.cleanup();
    }
  });

  it("surfaces unknown profile and non-profile plugin errors", async () => {
    const context = await createTestContext("cli-live-unknown-profile");
    try {
      await runCli(["init"]);
      const missing = await runCli([
        "profile", "add-resource", "nope",
        "--selector", "skill:foo",
        "--scope", "home",
      ]);
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain("Profile not found");

      createPlugin({ name: "plain" });
      const notProfile = await runCli([
        "profile", "add-resource", "plain",
        "--selector", "skill:foo",
        "--scope", "home",
      ]);
      expect(notProfile.exitCode).toBe(1);
      expect(notProfile.stderr).toContain("not tagged as a profile");
    } finally {
      await context.cleanup();
    }
  });

  it("commits via --path only and via --selector only", async () => {
    const context = await createTestContext("cli-live-commit");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const profile = await seedProfileWork();
      const skill = createResource({
        type: "skill",
        name: "manual-skill",
        description: "",
        content: "# original",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(profile.id, skill.id);
      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      const absolute = join(context.homeDir, SKILL_REL);
      writeFileSync(
        absolute,
        "---\nname: manual-skill\ndescription: updated\n---\n\n# updated live",
        "utf-8",
      );

      const byPath = await runCli([
        "profile", "commit-resource", "work",
        "--path", SKILL_REL,
        "--scope", "home",
        "--harness", "claude-code",
      ]);
      expect(byPath.stdout).toContain(`Committed ${SKILL_REL} into profile work.`);
      expect(getResource(skill.id)?.content).toContain("# updated live");

      writeFileSync(
        absolute,
        "---\nname: manual-skill\ndescription: again\n---\n\n# selector live",
        "utf-8",
      );
      const bySelector = await runCli([
        "profile", "commit-resource", "work",
        "--selector", "skill:manual-skill",
        "--scope", "home",
        "--harness", "claude-code",
        "--format", "json",
      ]);
      const body = JSON.parse(bySelector.stdout);
      expect(body.resource).toEqual(expect.objectContaining({ name: "manual-skill" }));
      expect(getResource(skill.id)?.content).toContain("# selector live");
    } finally {
      await context.cleanup();
    }
  });

  it("requires --path or --selector for commit-resource", async () => {
    const context = await createTestContext("cli-live-commit-missing");
    try {
      await runCli(["init"]);
      await seedProfileWork();
      const result = await runCli([
        "profile", "commit-resource", "work",
        "--scope", "home",
      ]);
      expect(result.exitCode).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain("path");
    } finally {
      await context.cleanup();
    }
  });

  it("removes a resource with -y and honors TTY confirm", async () => {
    const context = await createTestContext("cli-live-remove");
    try {
      await runCli(["init"]);
      const profile = await seedProfileWork();
      const skill = createResource({
        type: "skill",
        name: "demo-skill",
        description: "",
        content: "# demo",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(profile.id, skill.id);

      const cancelled = await runCli(
        ["profile", "remove-resource", "work", "--selector", "skill:demo-skill"],
        { isTTY: true, promptResponses: [{ value: false }] },
      );
      expect(cancelled.stdout).toContain("Operation cancelled.");
      expect(cancelled.exitCode === undefined || cancelled.exitCode === 0).toBe(true);
      expect(getPluginResources(profile.id)).toHaveLength(1);

      const refused = await runCli([
        "profile", "remove-resource", "work", "--selector", "skill:demo-skill",
      ]);
      expect(refused.exitCode).toBe(1);
      expect(refused.stdout).toContain("Pass -y to confirm.");
      expect(getPluginResources(profile.id)).toHaveLength(1);

      const jsonRefused = await runCli([
        "profile", "remove-resource", "work",
        "--selector", "skill:demo-skill",
        "--format", "json",
      ]);
      expect(jsonRefused.exitCode).toBe(1);
      expect(getPluginResources(profile.id)).toHaveLength(1);

      const confirmed = await runCli(
        ["profile", "remove-resource", "work", "--selector", "skill:demo-skill"],
        { isTTY: true, promptResponses: [{ value: true }] },
      );
      expect(confirmed.stdout).toContain("Removed skill:demo-skill from profile work.");
      expect(getPluginResources(profile.id)).toHaveLength(0);

      addResourceToPlugin(profile.id, skill.id);
      const skipped = await runCli([
        "profile", "remove-resource", "work",
        "--selector", "skill:demo-skill",
        "-y",
        "--format", "json",
      ]);
      const body = JSON.parse(skipped.stdout);
      expect(body.resource).toEqual(expect.objectContaining({ name: "demo-skill" }));
      expect(getPluginResources(profile.id)).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("restores a managed file with confirm/-y and diffs unified text", async () => {
    const context = await createTestContext("cli-live-restore-diff");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const profile = await seedProfileWork();
      const skill = createResource({
        type: "skill",
        name: "manual-skill",
        description: "",
        content: "# original",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(profile.id, skill.id);
      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      const absolute = join(context.homeDir, SKILL_REL);
      const drifted =
        "---\nname: manual-skill\ndescription: x\n---\n\n# drifted\n";
      writeFileSync(absolute, drifted, "utf-8");

      const diffHuman = await runCli([
        "profile", "file-diff", "work",
        "--path", SKILL_REL,
        "--scope", "home",
        "--harness", "claude-code",
      ]);
      expect(diffHuman.stdout).toContain("--- a/");
      expect(diffHuman.stdout).toContain("+++ b/");

      const diffJson = await runCli([
        "profile", "file-diff", "work",
        "--path", SKILL_REL,
        "--scope", "home",
        "--harness", "claude-code",
        "--format", "json",
      ]);
      const diffBody = JSON.parse(diffJson.stdout);
      expect(diffBody.path).toBe(SKILL_REL);
      expect(diffBody.expected).toContain("# original");
      expect(diffBody.current).toBe(drifted);
      expect(diffBody.diff).toBeUndefined();

      const cancelled = await runCli(
        [
          "profile", "restore-file", "work",
          "--path", SKILL_REL,
          "--scope", "home",
          "--harness", "claude-code",
        ],
        { isTTY: true, promptResponses: [{ value: false }] },
      );
      expect(cancelled.stdout).toContain("Operation cancelled.");
      expect(readFileSync(absolute, "utf-8")).toContain("# drifted");

      const refused = await runCli([
        "profile", "restore-file", "work",
        "--path", SKILL_REL,
        "--scope", "home",
        "--harness", "claude-code",
      ]);
      expect(refused.exitCode).toBe(1);
      expect(readFileSync(absolute, "utf-8")).toContain("# drifted");

      const restored = await runCli([
        "profile", "restore-file", "work",
        "--path", SKILL_REL,
        "--scope", "home",
        "--harness", "claude-code",
        "-y",
      ]);
      expect(restored.stdout).toContain(`Restored ${SKILL_REL}.`);
      expect(readFileSync(absolute, "utf-8")).toContain("# original");
      expect(readFileSync(absolute, "utf-8")).not.toContain("# drifted");

      writeFileSync(absolute, drifted, "utf-8");
      const jsonRestore = await runCli([
        "profile", "restore-file", "work",
        "--path", SKILL_REL,
        "--scope", "home",
        "--harness", "claude-code",
        "-y",
        "--format", "json",
      ]);
      const restoreBody = JSON.parse(jsonRestore.stdout);
      expect(restoreBody.path).toBe(SKILL_REL);
      expect(restoreBody.absolute_path).toBe(absolute);

      const unmanaged = await runCli([
        "profile", "file-diff", "work",
        "--path", ".claude/skills/missing/SKILL.md",
        "--scope", "home",
        "--harness", "claude-code",
      ]);
      expect(unmanaged.exitCode).toBe(1);
      expect(unmanaged.stderr).toContain("Path is not a managed file");
    } finally {
      await context.cleanup();
    }
  });
});
