import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { createCloudPublishFetchMock } from "../helpers/cloud-fetch.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  addResourceToPlugin,
  createPlugin,
  setPluginTags,
} from "../../src/models/plugin-model.ts";
import { makeApEnvelope } from "../helpers/ap-package-fixtures.ts";


describe("CLI profile", () => {
  it("lists and creates profile plugins", async () => {
    const context = await createTestContext("cli-profile-list-create");
    try {
      await runCli(["init"]);
      const listInitial = await runCli(["profile", "list", "--local-only"]);
      expect(listInitial.stdout).toContain("global default");

      const listAlias = await runCli(["p", "ls", "--local-only"]);
      expect(listAlias.stdout).toContain("global default");

      const createResult = await runCli(["profile", "create", "work"]);
      expect(createResult.stdout).toContain("Created profile");

      const listAfter = await runCli(["profile", "list", "--local-only"]);
      expect(listAfter.stdout).toContain("work");
    } finally {
      await context.cleanup();
    }
  });

  it("promotes an existing plugin and suggests switching", async () => {
    const context = await createTestContext("cli-profile-promote-existing");
    try {
      await runCli(["init"]);
      createPlugin({ name: "dbt-expert" });

      const createResult = await runCli(["profile", "create", "dbt-expert"]);
      expect(createResult.stdout).toContain("Tagged plugin");
      expect(createResult.stdout).toContain("dbt-expert");
      expect(createResult.stdout).toContain("profile use dbt-expert");
    } finally {
      await context.cleanup();
    }
  });

  it("prompts to enable a promoted profile interactively", async () => {
    const context = await createTestContext("cli-profile-promote-interactive");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const plugin = createPlugin({ name: "dbt-expert" });
      const resource = createResource({
        type: "instruction",
        name: "dbt-guide",
        description: "",
        content: "# dbt",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, resource.id);

      const createResult = await runCli(
        ["profile", "create", "dbt-expert"],
        {
          isTTY: true,
          promptResponses: [{ value: true }],
        },
      );
      expect(createResult.stdout).toContain("Tagged plugin");
      expect(createResult.stdout).toContain("Applied profile");

      const status = await runCli(["profile", "status"]);
      expect(status.stdout).toContain("dbt-expert");
    } finally {
      await context.cleanup();
    }
  });

  it("reports global profile status", async () => {
    const context = await createTestContext("cli-profile-status");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const pending = await runCli(["profile", "status"]);
      expect(pending.stdout).toContain("has not been applied globally");

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
      const synced = await runCli(["profile", "status"]);
      expect(synced.stdout).toContain("in sync");
    } finally {
      await context.cleanup();
    }
  });

  it("demotes a profile and keeps the plugin by default", async () => {
    const context = await createTestContext("cli-profile-delete-demote");
    try {
      await runCli(["init"]);
      const plugin = createPlugin({ name: "dbt-expert" });
      setPluginTags(plugin.id, ["profile"]);

      const result = await runCli(["profile", "delete", "dbt-expert"]);
      expect(result.stdout).toContain("Demoted profile");
      expect(result.stdout).toContain("plugin delete dbt-expert");

      const pluginModel = await import("../../src/models/plugin-model.ts");
      expect(pluginModel.getPlugin("dbt-expert")).toBeDefined();
      expect(pluginModel.getPlugin("dbt-expert")?.tags).not.toContain("profile");
    } finally {
      await context.cleanup();
    }
  });

  it("demotes a profile and deletes the plugin when confirmed", async () => {
    const context = await createTestContext("cli-profile-delete-plugin");
    try {
      await runCli(["init"]);
      const plugin = createPlugin({ name: "dbt-expert" });
      setPluginTags(plugin.id, ["profile"]);

      const result = await runCli(
        ["profile", "delete", "dbt-expert"],
        {
          isTTY: true,
          promptResponses: [{ value: true }],
        },
      );
      expect(result.stdout).toContain("Demoted profile");
      expect(result.stdout).toContain("Deleted plugin");

      const pluginModel = await import("../../src/models/plugin-model.ts");
      expect(pluginModel.getPlugin("dbt-expert")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("clears the active profile pointer when deleting the active profile", async () => {
    const context = await createTestContext("cli-profile-delete-active");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const plugin = createPlugin({ name: "dbt-expert" });
      setPluginTags(plugin.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "dbt-guide",
        description: "",
        content: "# dbt",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, resource.id);
      await runCli(["profile", "use", "dbt-expert", "--harness", "claude-code"]);

      const result = await runCli(["profile", "delete", "dbt-expert", "--plugin"]);
      expect(result.stdout).toContain("Cleared active profile pointer");

      const status = await runCli(["profile", "status", "--format", "json"]);
      expect(JSON.parse(status.stdout)).toMatchObject({
        active_profile: null,
        profile_exists: false,
      });
    } finally {
      await context.cleanup();
    }
  });

  it("supports create/use/active profile flow", async () => {
    const context = await createTestContext("cli-profile-use-active");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const basePlugin = createPlugin({ name: "work-plugin" });
      const resource = createResource({
        type: "instruction",
        name: "profile-work",
        description: "",
        content: "# work profile",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(basePlugin.id, resource.id);

      const created = await runCli(["profile", "create", "work-plugin", "--yes"]);
      expect(created.stdout).toContain("Tagged plugin");

      const dryRun = await runCli([
        "profile",
        "use",
        "work-plugin",
        "--dry-run",
        "--harness",
        "claude-code",
      ]);
      expect(dryRun.stdout).toContain("Applied profile");
      expect(dryRun.stdout).toContain("dry run");

      const apply = await runCli([
        "profile",
        "use",
        "work-plugin",
        "--harness",
        "claude-code",
      ]);
      expect(apply.stdout).toContain("Applied profile");

      const status = await runCli(["profile", "status"]);
      expect(status.stdout).toContain("work-plugin");
    } finally {
      await context.cleanup();
    }
  });

  it("profile show renders the same plugin detail panel as plugin show", async () => {
    const context = await createTestContext("cli-profile-show-panel");
    try {
      await runCli(["init"]);
      const plugin = createPlugin({ name: "dbt-expert" });
      setPluginTags(plugin.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "dbt-guide",
        description: "",
        content: "# dbt",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, resource.id);

      const pluginShow = await runCli(["plugin", "show", "dbt-expert"]);
      const profileShow = await runCli(["profile", "show", "dbt-expert"]);

      for (const marker of ["PLUGIN", "Description", "RESOURCES", "dbt-guide"]) {
        expect(pluginShow.stdout).toContain(marker);
        expect(profileShow.stdout).toContain(marker);
      }
      expect(profileShow.stdout).toContain("Active");
      expect(pluginShow.stdout).not.toContain("Active");

      const profileJson = JSON.parse(
        (await runCli(["profile", "show", "dbt-expert", "--format", "json"])).stdout,
      );
      expect(profileJson.name).toBe("dbt-expert");
      expect(profileJson.resources).toHaveLength(1);
      expect(profileJson.active).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("profile list --local-only omits remote catalog section", async () => {
    const context = await createTestContext("cli-profile-list-local-only");
    try {
      await runCli(["init"]);
      await runCli(["profile", "create", "work"]);

      const result = await runCli(["profile", "list", "--local-only", "--no-interactive"]);

      expect(result.stdout).toContain("work");
      expect(result.stdout).not.toContain("Remote catalog");
    } finally {
      await context.cleanup();
    }
  });

  it("supports profile list --search with profile tag filter", async () => {
    const context = await createTestContext("cli-profile-search");
    try {
      await runCli(["init"]);
      const cloudAccounts = await import("../../src/config/cloud-accounts.ts");
      await cloudAccounts.saveCloudAccount("test", {
        cloudBaseUrl: "https://mock",
        accessToken: "tok",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        refreshToken: "r",
        scopes: [],
      });
      await cloudAccounts.setDefaultCloudAccount("test");

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        plugins: [
          {
            orgSlug: "harnesstap-cloud",
            slug: "work-profile",
            name: "Work profile",
            summary: "Profile plugin",
            latestVersion: "1.0.0",
            updatedAt: new Date().toISOString(),
            tags: ["profile"],
            visibility: "public",
          },
          {
            orgSlug: "harnesstap-cloud",
            slug: "foundation",
            name: "Foundation",
            summary: "Regular plugin",
            latestVersion: "1.0.0",
            updatedAt: new Date().toISOString(),
            tags: ["baseline"],
            visibility: "public",
          },
        ],
      });

      const result = await runCli([
        "profile",
        "list",
        "--search",
        "work",
        "--remote-only",
        "--account",
        "test",
        "--base-url",
        "https://mock",
        "--format",
        "json",
      ]);
      const payload = JSON.parse(result.stdout) as Array<{ slug: string }>;
      expect(payload.map((entry) => entry.slug)).toContain("work-profile");
      expect(payload.map((entry) => entry.slug)).not.toContain("foundation");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("warns when profile pull installs a non-profile plugin", async () => {
    const context = await createTestContext("cli-profile-pull");
    try {
      await runCli(["init"]);
      const cloudAccounts = await import("../../src/config/cloud-accounts.ts");
      await cloudAccounts.saveCloudAccount("test", {
        cloudBaseUrl: "https://mock",
        accessToken: "tok",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        refreshToken: "r",
        scopes: [],
      });
      await cloudAccounts.setDefaultCloudAccount("test");

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
      });
      const pull = await runCli([
        "profile",
        "pull",
        "harnesstap-cloud/default/team@1.0.0",
        "--account",
        "test",
        "--base-url",
        "https://mock",
      ]);
      const pullOutput = `${pull.stdout}\n${pull.stderr}`;
      expect(pullOutput).toContain("Installed plugin remote-team");
      expect(pullOutput).toContain("is not tagged as a profile");
      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("warns on profile publish validations and still publishes", async () => {
    const context = await createTestContext("cli-profile-publish");
    try {
      await runCli(["init"]);
      const cloudAccounts = await import("../../src/config/cloud-accounts.ts");
      await cloudAccounts.saveCloudAccount("test", {
        cloudBaseUrl: "https://mock",
        accessToken: "tok",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        refreshToken: "r",
        scopes: [],
      });
      await cloudAccounts.setDefaultCloudAccount("test");

      const restorePublishFetch = createCloudPublishFetchMock({ baseUrl: "https://mock" });
      const orphan = createPlugin({ name: "orphan-profile" });
      setPluginTags(orphan.id, ["profile"]);

      const _depTarget = createPlugin({ name: "local-dep" });
      const depProfile = createPlugin({ name: "dep-profile" });
      setPluginTags(depProfile.id, ["profile"]);
      const composition = await import("../../src/services/plugin-composition.ts");
      const depResource = composition.ensurePluginResource("local-dep");
      addResourceToPlugin(depProfile.id, depResource.id);

      await runCli(["plugin", "catalog", "register", "acme/default"]);

      const result = await runCli([
        "profile",
        "publish",
        "dep-profile",
        "--account",
        "test",
      ]);
      const publishOutput = `${result.stdout}\n${result.stderr}`;
      expect(publishOutput).toContain("unpublished local plugins");
      expect(publishOutput).toContain("Published dep-profile to acme/dep-profile");

      const emptyResult = await runCli([
        "profile",
        "publish",
        "orphan-profile",
        "--org",
        "acme",
        "--account",
        "test",
      ]);
      const emptyPublishOutput = `${emptyResult.stdout}\n${emptyResult.stderr}`;
      expect(emptyPublishOutput).toContain("no plugin references and no material resources");
      expect(emptyPublishOutput).toContain("Published orphan-profile to acme/orphan-profile");

      restorePublishFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("supports root shorthand dispatch to profile use", async () => {
    const context = await createTestContext("cli-profile-shorthand");
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

      const shorthand = await runCli(["work", "--harness", "claude-code", "--dry-run"]);
      expect(shorthand.stdout).toContain("Applied profile");
      expect(shorthand.stdout).toContain("work");

      const reserved = await runCli(["init", "--format", "json"]);
      expect(reserved.stdout).toContain("{");
      expect(reserved.stdout).not.toContain("Applied profile");
    } finally {
      await context.cleanup();
    }
  });

  it("rewrites profile shorthand after global flags", async () => {
    const context = await createTestContext("cli-profile-shorthand-flags");
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

      const shorthand = await runCli([
        "--no-color",
        "--no-interactive",
        "work",
        "--harness",
        "claude-code",
        "--dry-run",
      ]);
      expect(shorthand.exitCode ?? 0).toBe(0);
      expect(shorthand.stderr).not.toContain("unknown command");
      expect(shorthand.stdout).toContain("Applied profile");
    } finally {
      await context.cleanup();
    }
  });

  it("auto-pulls missing published dependencies on profile use", async () => {
    const context = await createTestContext("cli-profile-use-auto-pull");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const cloudAccounts = await import("../../src/config/cloud-accounts.ts");
      await cloudAccounts.saveCloudAccount("test", {
        cloudBaseUrl: "https://mock",
        accessToken: "tok",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        refreshToken: "r",
        scopes: [],
      });
      await cloudAccounts.setDefaultCloudAccount("test");

      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const composition = await import("../../src/services/plugin-composition.ts");
      const ref = composition.ensurePluginResource("harnesstap-cloud/default/remote-base", {
        versionConstraint: "1.0.0",
      });
      addResourceToPlugin(profile.id, ref.id);

      const dependencyBundle = makeApEnvelope({
        name: "remote-base",
        description: "Remote base",
        skillName: "remote-guide",
        skillBody: "# remote",
      });
      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        plugins: [{
          orgSlug: "harnesstap-cloud",
          slug: "remote-base",
          name: "Remote Base",
          summary: "Dependency",
          latestVersion: "1.0.0",
          updatedAt: new Date().toISOString(),
          tags: [],
          visibility: "public",
        }],
        bundle: dependencyBundle,
      });

      const noPull = await runCli([
        "profile",
        "use",
        "work",
        "--harness",
        "claude-code",
        "--dry-run",
        "--no-pull",
      ]);
      expect(`${noPull.stdout}\n${noPull.stderr}`).toContain("Re-run without --no-pull");

      const apply = await runCli([
        "profile",
        "use",
        "work",
        "--harness",
        "claude-code",
        "--dry-run",
        "--account",
        "test",
        "--base-url",
        "https://mock",
      ]);
      const applyOutput = `${apply.stdout}\n${apply.stderr}`;
      expect(applyOutput).toContain("Pulled 1 missing plugin dependencies");
      expect(applyOutput).toContain("remote-base");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("removes dbt-only skills through the profile use command flow", async () => {
    const context = await createTestContext("cli-profile-switch-dbt-default");
    try {
      await runCli(["init", "--main", "claude-code", "--no-default-profile"]);

      const workPlugin = createPlugin({ name: "work" });
      setPluginTags(workPlugin.id, ["profile"]);
      addResourceToPlugin(
        workPlugin.id,
        createResource({
          type: "skill",
          name: "shared-skill",
          description: "shared",
          content: "# Shared",
          metadata: {},
          source: "manual",
        }).id,
      );

      const dbtPlugin = createPlugin({ name: "dbt-expert" });
      setPluginTags(dbtPlugin.id, ["profile"]);
      addResourceToPlugin(
        dbtPlugin.id,
        createResource({
          type: "skill",
          name: "shared-skill",
          description: "shared",
          content: "# Shared",
          metadata: {},
          source: "manual",
        }).id,
      );
      addResourceToPlugin(
        dbtPlugin.id,
        createResource({
          type: "skill",
          name: "dbt-only-skill",
          description: "dbt",
          content: "# DBT only",
          metadata: {},
          source: "manual",
        }).id,
      );

      await runCli(["profile", "use", "dbt-expert", "--harness", "claude-code"]);
      const dbtOnlyPath = join(
        context.homeDir,
        ".claude/skills/dbt-only-skill/SKILL.md",
      );
      expect(existsSync(dbtOnlyPath)).toBe(true);

      const switched = await runCli([
        "profile",
        "use",
        "work",
        "--harness",
        "claude-code",
        "--on-conflict",
        "replace",
      ]);
      expect(switched.stdout).toContain("Applied profile");
      expect(existsSync(dbtOnlyPath)).toBe(false);

      const reapplied = await runCli([
        "profile",
        "use",
        "work",
        "--harness",
        "claude-code",
      ], {
        isTTY: true,
      });
      expect(reapplied.stdout).not.toContain("File already exists");
      expect(reapplied.stdout).toContain("Applied profile");
    } finally {
      await context.cleanup();
    }
  });

  it("prompts to update the active profile from the main harness before switching", async () => {
    const context = await createTestContext("cli-profile-switch-sync-prompt");
    try {
      const { mkdirSync, writeFileSync } = await import("node:fs");

      await runCli(["init", "--main", "claude-code"]);

      const profileA = createPlugin({ name: "profile-a" });
      setPluginTags(profileA.id, ["profile"]);
      addResourceToPlugin(
        profileA.id,
        createResource({
          type: "skill",
          name: "kept-skill",
          description: "kept",
          content: "# kept",
          metadata: {},
          source: "manual",
        }).id,
      );

      const profileB = createPlugin({ name: "profile-b" });
      setPluginTags(profileB.id, ["profile"]);
      addResourceToPlugin(
        profileB.id,
        createResource({
          type: "skill",
          name: "other-skill",
          description: "other",
          content: "# other",
          metadata: {},
          source: "manual",
        }).id,
      );

      await runCli(["profile", "use", "profile-a", "--harness", "claude-code"]);

      mkdirSync(join(context.homeDir, ".claude", "skills", "manual-skill"), {
        recursive: true,
      });
      writeFileSync(
        join(context.homeDir, ".claude", "skills", "manual-skill", "SKILL.md"),
        "---\nname: manual-skill\ndescription: manual\n---\n\n# manual",
        "utf-8",
      );

      const switchResult = await runCli(
        ["profile", "use", "profile-b", "--harness", "claude-code"],
        {
          isTTY: true,
          promptResponses: [{ value: true }],
        },
      );

      expect(switchResult.stdout).toContain("out of sync");
      expect(switchResult.stdout).toContain("Updated profile");
      expect(switchResult.stdout).toContain("Applied profile");
    } finally {
      await context.cleanup();
    }
  });
});
