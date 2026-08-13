import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import inquirer from "inquirer";
import { isProfilePlugin } from "../../src/constants/profile.ts";
import {
  handleProfileCreateCommand,
  registerProfileCreateSourceOptions,
} from "../../src/cli/handlers/profile-create.ts";
import {
  createPlugin,
  getPluginByName,
  getPluginResources,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext, createTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

async function runCreate(
  name: string,
  opts: Parameters<typeof handleProfileCreateCommand>[1],
): Promise<void> {
  await handleProfileCreateCommand(name, opts);
}

describe("profile create sources — validation", () => {
  it("rejects combining --compose and --from-home", async () => {
    const context = await createInitializedTestContext("create-src-exclusive");
    try {
      await expect(
        runCreate("work", { compose: true, fromHome: true, format: "json" }),
      ).rejects.toThrow(
        "Pass only one of --from, --compose, --from-home, or --from-project.",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects combining --from and --from-project", async () => {
    const context = await createInitializedTestContext("create-src-from-pair");
    try {
      await expect(
        runCreate("work", {
          from: "owner/repo",
          fromProject: ".",
          format: "json",
        }),
      ).rejects.toThrow(
        "Pass only one of --from, --compose, --from-home, or --from-project.",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects --preview on empty create", async () => {
    const context = await createInitializedTestContext("create-src-preview-empty");
    try {
      await expect(
        runCreate("work", { preview: true, format: "human" }),
      ).rejects.toThrow(
        "--preview applies to --compose, --from-home, and --from-project. Skill-package create uses --dry-run.",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects --preview with --from", async () => {
    const context = await createInitializedTestContext("create-src-preview-from");
    try {
      await expect(
        runCreate("work", { from: "owner/repo", preview: true }),
      ).rejects.toThrow(
        "--preview applies to --compose, --from-home, and --from-project. Skill-package create uses --dry-run.",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects --preview with --use", async () => {
    const context = await createInitializedTestContext("create-src-preview-use");
    try {
      await expect(
        runCreate("work", { compose: true, plugins: "engineering", preview: true, use: true }),
      ).rejects.toThrow("Do not combine --preview with --use or --dry-run.");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects --plugins without --compose", async () => {
    const context = await createInitializedTestContext("create-src-plugins-flag");
    try {
      await expect(
        runCreate("work", { plugins: "engineering" }),
      ).rejects.toThrow("--plugins and --resources are only valid with --compose.");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects --on-conflict on --compose", async () => {
    const context = await createInitializedTestContext("create-src-compose-conflict");
    try {
      await expect(
        runCreate("work", {
          compose: true,
          plugins: "engineering",
          onConflict: "skip",
        }),
      ).rejects.toThrow(
        "--on-conflict is only valid with --from, --from-home, or --from-project.",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects merge --on-conflict on --from-home", async () => {
    const context = await createInitializedTestContext("create-src-home-merge");
    try {
      await expect(
        runCreate("work", { fromHome: true, onConflict: "merge" }),
      ).rejects.toThrow("Invalid --on-conflict value: merge. Use skip or overwrite.");
    } finally {
      await context.cleanup();
    }
  });
});

async function captureCreate(
  name: string,
  opts: Parameters<typeof handleProfileCreateCommand>[1],
): Promise<{ stdout: string; parsed?: unknown }> {
  const chunks: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    chunks.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    await handleProfileCreateCommand(name, opts);
  } finally {
    console.log = originalLog;
  }
  const stdout = chunks.join("\n");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = undefined;
  }
  return { stdout, parsed };
}

describe("profile create sources — compose", () => {
  it("commits --compose from plugin and resource names and prints agent-shaped JSON", async () => {
    const context = await createInitializedTestContext("create-src-compose-commit");
    try {
      createPlugin({ name: "engineering" });
      createResource({
        type: "skill",
        name: "review",
        description: "Review changes",
        content: "# Review",
        metadata: {},
        source: "manual",
      });

      const { parsed } = await captureCreate("work", {
        compose: true,
        plugins: "engineering",
        resources: "review",
        description: "Work profile",
        format: "json",
      });

      expect(parsed).toEqual({
        profile: {
          name: "work",
          id: expect.any(String),
          version: "1.0.0",
        },
        imported_count: 2,
        used: false,
      });
      const plugin = getPluginByName("work");
      expect(plugin).toBeDefined();
      expect(plugin ? isProfilePlugin(plugin) : false).toBe(true);
      expect(
        getPluginResources(plugin!.id).map(({ type, name }) => ({ type, name })),
      ).toEqual([
        { type: "plugin", name: "engineering" },
        { type: "skill", name: "review" },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("previews compose without creating a plugin", async () => {
    const context = await createInitializedTestContext("create-src-compose-preview");
    try {
      createPlugin({ name: "engineering" });
      const { parsed } = await captureCreate("work", {
        compose: true,
        plugins: "engineering",
        preview: true,
        format: "json",
      });
      expect(parsed).toEqual({
        source: "compose",
        name: "work",
        totalImports: 1,
        conflicts: [],
        warnings: [],
      });
      expect(getPluginByName("work")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("resolves unknown plugin selectors with Plugin not found", async () => {
    const context = await createInitializedTestContext("create-src-compose-missing");
    try {
      await expect(
        handleProfileCreateCommand("work", {
          compose: true,
          plugins: "missing-plugin",
          format: "json",
        }),
      ).rejects.toThrow("Plugin not found: missing-plugin");
    } finally {
      await context.cleanup();
    }
  });

  it("requires at least one selection when compose is non-interactive", async () => {
    const context = await createInitializedTestContext("create-src-compose-empty");
    try {
      await expect(
        handleProfileCreateCommand("work", {
          compose: true,
          noInteractive: true,
          format: "json",
        }),
      ).rejects.toThrow(
        "A composed profile requires at least one plugin or resource selection",
      );
      expect(getPluginByName("work")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });
});

function writeHomeSkill(homeRoot: string, name = "research", content = "# Research"): void {
  writeTextFile(
    `${homeRoot}/.claude/skills/${name}/SKILL.md`,
    `---\nname: ${name}\ndescription: Home helper\n---\n${content}`,
  );
}

describe("profile create sources — home and project", () => {
  it("previews --from-home without creating a plugin and lists conflicts", async () => {
    const context = await createInitializedTestContext("create-src-home-preview");
    try {
      createResource({
        type: "skill",
        name: "research",
        description: "Existing helper",
        content: "# Existing",
        metadata: {},
        source: "manual",
      });
      writeHomeSkill(context.homeDir, "research", "# Incoming");

      const { parsed, stdout } = await captureCreate("from-home", {
        fromHome: true,
        preview: true,
        format: "json",
      });
      expect(parsed).toMatchObject({
        source: "home",
        name: "from-home",
        totalImports: expect.any(Number),
      });
      const preview = parsed as { conflicts: unknown[]; totalImports: number };
      expect(preview.conflicts.length).toBeGreaterThan(0);
      expect(getPluginByName("from-home")).toBeUndefined();

      const human = await captureCreate("from-home", {
        fromHome: true,
        preview: true,
        format: "human",
      });
      expect(human.stdout).toContain("Would create profile");
      expect(human.stdout).toContain("from home");
      expect(human.stdout).toContain("skill: research");
      expect(getPluginByName("from-home")).toBeUndefined();
      expect(stdout).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });

  it("commits --from-home with default skip policy", async () => {
    const context = await createInitializedTestContext("create-src-home-commit");
    try {
      writeHomeSkill(context.homeDir);
      const { parsed } = await captureCreate("from-home", {
        fromHome: true,
        format: "json",
      });
      expect(parsed).toMatchObject({
        profile: { name: "from-home" },
        used: false,
      });
      expect(getPluginByName("from-home")).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });

  it("forwards --on-conflict overwrite for --from-project", async () => {
    const context = await createInitializedTestContext("create-src-project-overwrite");
    try {
      const existing = createResource({
        type: "skill",
        name: "research",
        description: "Existing helper",
        content: "# Existing",
        metadata: {},
        source: "manual",
        namespace: "project-profile",
      });
      writeTextFile(
        `${context.projectDir}/.claude/skills/research/SKILL.md`,
        "---\nname: research\ndescription: Incoming\n---\n# Incoming",
      );

      await handleProfileCreateCommand("project-profile", {
        fromProject: context.projectDir,
        onConflict: "overwrite",
        format: "json",
      });

      const plugin = getPluginByName("project-profile");
      expect(plugin).toBeDefined();
      const attached = getPluginResources(plugin!.id);
      const research = attached.find((resource) => resource.name === "research");
      expect(research?.id).toBe(existing.id);
      expect(research?.content).toContain("Incoming");
    } finally {
      await context.cleanup();
    }
  });
});

const skillPackageFixture = join(
  import.meta.dirname,
  "../fixtures/skill-packages/mattpocock-minimal",
);

describe("profile create sources — use, from, empty", () => {
  it("applies globally after compose commit with --use --yes", async () => {
    const context = await createInitializedTestContext("create-src-compose-use");
    try {
      createPlugin({ name: "engineering" });
      const { stdout } = await captureCreate("work", {
        compose: true,
        plugins: "engineering",
        use: true,
        yes: true,
        harness: "claude-code",
        format: "human",
      });
      expect(stdout).toContain("Created profile");
      expect(stdout).toContain("Applied profile");
    } finally {
      await context.cleanup();
    }
  });

  it("does not write when --preview is combined with --use (already validated)", async () => {
    const context = await createInitializedTestContext("create-src-preview-use-nowrite");
    try {
      createPlugin({ name: "engineering" });
      await expect(
        handleProfileCreateCommand("work", {
          compose: true,
          plugins: "engineering",
          preview: true,
          use: true,
        }),
      ).rejects.toThrow("Do not combine --preview with --use or --dry-run.");
      expect(getPluginByName("work")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("still creates an empty profile with no source flags", async () => {
    const context = await createTestContext("create-src-empty-runcli");
    try {
      await runCli(["init"]);
      const result = await runCli(["profile", "create", "work"]);
      expect(result.stdout).toContain("Created profile");
      expect(result.exitCode ?? 0).toBe(0);
    } finally {
      await context.cleanup();
    }
  });

  it("keeps skill-package --from and --on-conflict merge", async () => {
    const context = await createTestContext("create-src-from-unchanged");
    try {
      await runCli(["init"]);
      const first = await runCli([
        "profile",
        "create",
        "dbt-expert",
        "--from",
        skillPackageFixture,
        "--skill",
        "caveman",
        "--yes",
      ]);
      expect(first.exitCode ?? 0).toBe(0);
      const merged = await runCli([
        "profile",
        "create",
        "dbt-expert",
        "--from",
        skillPackageFixture,
        "--skill",
        "tdd",
        "--on-conflict",
        "merge",
        "--yes",
      ]);
      expect(merged.exitCode ?? 0).toBe(0);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects --preview via handler for --from without calling skill-package import", async () => {
    const context = await createInitializedTestContext("create-src-from-preview");
    try {
      await expect(
        handleProfileCreateCommand("dbt-expert", {
          from: skillPackageFixture,
          preview: true,
          yes: true,
        }),
      ).rejects.toThrow(
        "--preview applies to --compose, --from-home, and --from-project. Skill-package create uses --dry-run.",
      );
    } finally {
      await context.cleanup();
    }
  });
});

describe("profile create sources — compose wizard", () => {
  it("prompts for plugins and resources when --compose has no selectors", async () => {
    const context = await createInitializedTestContext("create-src-compose-wizard");
    const previousForce = process.env.HARNESSTAP_FORCE_WIZARD;
    const previousCi = process.env.CI;
    process.env.HARNESSTAP_FORCE_WIZARD = "1";
    delete process.env.CI;
    const dependency = createPlugin({ name: "engineering" });
    const previousPrompt = inquirer.prompt;
    const promptCalls: unknown[] = [];
    inquirer.prompt = (async (...args: Parameters<typeof inquirer.prompt>) => {
      promptCalls.push(args);
      return {
        pluginIds: [dependency.id],
        resourceIds: [],
      };
    }) as typeof inquirer.prompt;
    try {
      await handleProfileCreateCommand("work", {
        compose: true,
        interactive: true,
        format: "human",
      });
      expect(promptCalls.length).toBeGreaterThan(0);
      expect(getPluginByName("work")).toBeDefined();
    } finally {
      inquirer.prompt = previousPrompt;
      if (previousForce === undefined) {
        delete process.env.HARNESSTAP_FORCE_WIZARD;
      } else {
        process.env.HARNESSTAP_FORCE_WIZARD = previousForce;
      }
      if (previousCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = previousCi;
      }
      await context.cleanup();
    }
  });

  it("does not prompt when --no-interactive and no selectors", async () => {
    const context = await createInitializedTestContext("create-src-compose-no-int");
    const previousPrompt = inquirer.prompt;
    const promptCalls: unknown[] = [];
    inquirer.prompt = (async (...args: Parameters<typeof inquirer.prompt>) => {
      promptCalls.push(args);
      throw new Error("inquirer.prompt should not be called");
    }) as typeof inquirer.prompt;
    try {
      await expect(
        handleProfileCreateCommand("work", {
          compose: true,
          noInteractive: true,
          format: "human",
        }),
      ).rejects.toThrow(
        "A composed profile requires at least one plugin or resource selection",
      );
      expect(promptCalls).toEqual([]);
    } finally {
      inquirer.prompt = previousPrompt;
      await context.cleanup();
    }
  });
});

describe("registerProfileCreateSourceOptions", () => {
  it("parses --compose --from-home --from-project --preview and --no-interactive", () => {
    const command = new Command();
    command.exitOverride();
    command.allowUnknownOption(false);
    registerProfileCreateSourceOptions(command);
    command.parse(
      [
        "--compose",
        "--plugins",
        "a,b",
        "--resources",
        "r1",
        "--preview",
        "--no-interactive",
      ],
      { from: "user" },
    );
    expect(command.opts()).toMatchObject({
      compose: true,
      preview: true,
      interactive: false,
    });
    const plugins = command.opts().plugins as string[];
    expect(plugins.flatMap((entry) => entry.split(","))).toEqual(["a", "b"]);

    const projectCmd = new Command();
    projectCmd.exitOverride();
    registerProfileCreateSourceOptions(projectCmd);
    projectCmd.parse(["--from-home", "--from-project", "."], { from: "user" });
    expect(projectCmd.opts()).toMatchObject({
      fromHome: true,
      fromProject: ".",
    });
  });
});
