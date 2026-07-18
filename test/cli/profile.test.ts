import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { createCloudPublishFetchMock } from "../helpers/cloud-fetch.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  addResourceToLayer,
  createLayer,
  setLayerTags,
} from "../../src/models/layer-model.ts";
import { formatLayerExportToml } from "../../src/services/transport/layer.ts";

describe("CLI profile", () => {
  it("lists and creates profile layers", async () => {
    const context = await createTestContext("cli-profile-list-create");
    try {
      await runCli(["init"]);
      const listInitial = await runCli(["profile", "list", "--local-only"]);
      expect(listInitial.stdout).toContain("default");

      const listAlias = await runCli(["p", "ls", "--local-only"]);
      expect(listAlias.stdout).toContain("default");

      const createResult = await runCli(["profile", "create", "work"]);
      expect(createResult.stdout).toContain("Created profile");

      const listAfter = await runCli(["profile", "list", "--local-only"]);
      expect(listAfter.stdout).toContain("work");
    } finally {
      await context.cleanup();
    }
  });

  it("promotes an existing layer and suggests switching", async () => {
    const context = await createTestContext("cli-profile-promote-existing");
    try {
      await runCli(["init"]);
      createLayer({ name: "dbt-expert" });

      const createResult = await runCli(["profile", "create", "dbt-expert"]);
      expect(createResult.stdout).toContain("Tagged layer");
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
      const layer = createLayer({ name: "dbt-expert" });
      const resource = createResource({
        type: "instruction",
        name: "dbt-guide",
        description: "",
        content: "# dbt",
        metadata: {},
        source: "manual",
      });
      addResourceToLayer(layer.id, resource.id);

      const createResult = await runCli(
        ["profile", "create", "dbt-expert"],
        {
          isTTY: true,
          promptResponses: [{ value: true }],
        },
      );
      expect(createResult.stdout).toContain("Tagged layer");
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

      const layer = createLayer({ name: "work" });
      setLayerTags(layer.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "work-guide",
        description: "",
        content: "# work",
        metadata: {},
        source: "manual",
      });
      addResourceToLayer(layer.id, resource.id);

      await runCli(["profile", "use", "work", "--harness", "claude-code"]);
      const synced = await runCli(["profile", "status"]);
      expect(synced.stdout).toContain("in sync");
    } finally {
      await context.cleanup();
    }
  });

  it("demotes a profile and keeps the layer by default", async () => {
    const context = await createTestContext("cli-profile-delete-demote");
    try {
      await runCli(["init"]);
      const layer = createLayer({ name: "dbt-expert" });
      setLayerTags(layer.id, ["profile"]);

      const result = await runCli(["profile", "delete", "dbt-expert"]);
      expect(result.stdout).toContain("Demoted profile");
      expect(result.stdout).toContain("layer delete dbt-expert");

      const layerModel = await import("../../src/models/layer-model.ts");
      expect(layerModel.getLayer("dbt-expert")).toBeDefined();
      expect(layerModel.getLayer("dbt-expert")?.tags).not.toContain("profile");
    } finally {
      await context.cleanup();
    }
  });

  it("demotes a profile and deletes the layer when confirmed", async () => {
    const context = await createTestContext("cli-profile-delete-layer");
    try {
      await runCli(["init"]);
      const layer = createLayer({ name: "dbt-expert" });
      setLayerTags(layer.id, ["profile"]);

      const result = await runCli(
        ["profile", "delete", "dbt-expert"],
        {
          isTTY: true,
          promptResponses: [{ value: true }],
        },
      );
      expect(result.stdout).toContain("Demoted profile");
      expect(result.stdout).toContain("Deleted layer");

      const layerModel = await import("../../src/models/layer-model.ts");
      expect(layerModel.getLayer("dbt-expert")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("clears the active profile pointer when deleting the active profile", async () => {
    const context = await createTestContext("cli-profile-delete-active");
    try {
      await runCli(["init", "--main", "claude-code"]);
      const layer = createLayer({ name: "dbt-expert" });
      setLayerTags(layer.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "dbt-guide",
        description: "",
        content: "# dbt",
        metadata: {},
        source: "manual",
      });
      addResourceToLayer(layer.id, resource.id);
      await runCli(["profile", "use", "dbt-expert", "--harness", "claude-code"]);

      const result = await runCli(["profile", "delete", "dbt-expert", "--layer"]);
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
      const baseLayer = createLayer({ name: "work-layer" });
      const resource = createResource({
        type: "instruction",
        name: "profile-work",
        description: "",
        content: "# work profile",
        metadata: {},
        source: "manual",
      });
      addResourceToLayer(baseLayer.id, resource.id);

      const created = await runCli(["profile", "create", "work-layer", "--yes"]);
      expect(created.stdout).toContain("Tagged layer");

      const dryRun = await runCli([
        "profile",
        "use",
        "work-layer",
        "--dry-run",
        "--harness",
        "claude-code",
      ]);
      expect(dryRun.stdout).toContain("Applied profile");
      expect(dryRun.stdout).toContain("dry run");

      const apply = await runCli([
        "profile",
        "use",
        "work-layer",
        "--harness",
        "claude-code",
      ]);
      expect(apply.stdout).toContain("Applied profile");

      const status = await runCli(["profile", "status"]);
      expect(status.stdout).toContain("work-layer");
    } finally {
      await context.cleanup();
    }
  });

  it("profile show renders the same layer detail panel as layer show", async () => {
    const context = await createTestContext("cli-profile-show-panel");
    try {
      await runCli(["init"]);
      const layer = createLayer({ name: "dbt-expert" });
      setLayerTags(layer.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "dbt-guide",
        description: "",
        content: "# dbt",
        metadata: {},
        source: "manual",
      });
      addResourceToLayer(layer.id, resource.id);

      const layerShow = await runCli(["layer", "show", "dbt-expert"]);
      const profileShow = await runCli(["profile", "show", "dbt-expert"]);

      for (const marker of ["LAYER", "Description", "RESOURCES", "dbt-guide"]) {
        expect(layerShow.stdout).toContain(marker);
        expect(profileShow.stdout).toContain(marker);
      }
      expect(profileShow.stdout).toContain("Active");
      expect(layerShow.stdout).not.toContain("Active");

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
        layers: [
          {
            orgSlug: "harnesstap-cloud",
            slug: "work-profile",
            name: "Work profile",
            summary: "Profile layer",
            latestVersion: "1.0.0",
            updatedAt: new Date().toISOString(),
            tags: ["profile"],
            visibility: "public",
          },
          {
            orgSlug: "harnesstap-cloud",
            slug: "foundation",
            name: "Foundation",
            summary: "Regular layer",
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

  it("warns when profile pull installs a non-profile layer", async () => {
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
      expect(pullOutput).toContain("Installed layer remote-team");
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
      const orphan = createLayer({ name: "orphan-profile" });
      setLayerTags(orphan.id, ["profile"]);

      const _depTarget = createLayer({ name: "local-dep" });
      const depProfile = createLayer({ name: "dep-profile" });
      setLayerTags(depProfile.id, ["profile"]);
      const composition = await import("../../src/services/layer-composition.ts");
      const depResource = composition.ensureLayerResource("local-dep");
      addResourceToLayer(depProfile.id, depResource.id);

      await runCli(["layer", "catalog", "register", "acme/default"]);

      const result = await runCli([
        "profile",
        "publish",
        "dep-profile",
        "--account",
        "test",
      ]);
      const publishOutput = `${result.stdout}\n${result.stderr}`;
      expect(publishOutput).toContain("unpublished local layers");
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
      expect(emptyPublishOutput).toContain("no layer references and no material resources");
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
      const layer = createLayer({ name: "work" });
      setLayerTags(layer.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "work-guide",
        description: "",
        content: "# work",
        metadata: {},
        source: "manual",
      });
      addResourceToLayer(layer.id, resource.id);

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

      const profile = createLayer({ name: "work" });
      setLayerTags(profile.id, ["profile"]);
      const composition = await import("../../src/services/layer-composition.ts");
      const ref = composition.ensureLayerResource("harnesstap-cloud/default/remote-base", {
        versionConstraint: "1.0.0",
      });
      addResourceToLayer(profile.id, ref.id);

      const dependencyBundle = formatLayerExportToml({
        $schema: "urn:harnesstap:layer:v1",
        version: 1,
        layers: [{
          name: "remote-base",
          version: "1.0.0",
          description: "Remote base",
          tags: [],
          resources: [{
            type: "instruction",
            name: "remote-guide",
            description: "",
            content: "# remote",
            metadata: {},
            namespace: "",
            origin_kind: "manual",
            origin_ref: "",
            content_hash: "",
            content_blob_ref: "",
          }],
          plugin_pins: [],
        }],
        embedded_plugins: [],
      });
      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        layers: [{
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
      expect(applyOutput).toContain("Pulled 1 missing layer dependencies");
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

      const workLayer = createLayer({ name: "work" });
      setLayerTags(workLayer.id, ["profile"]);
      addResourceToLayer(
        workLayer.id,
        createResource({
          type: "skill",
          name: "shared-skill",
          description: "shared",
          content: "# Shared",
          metadata: {},
          source: "manual",
        }).id,
      );

      const dbtLayer = createLayer({ name: "dbt-expert" });
      setLayerTags(dbtLayer.id, ["profile"]);
      addResourceToLayer(
        dbtLayer.id,
        createResource({
          type: "skill",
          name: "shared-skill",
          description: "shared",
          content: "# Shared",
          metadata: {},
          source: "manual",
        }).id,
      );
      addResourceToLayer(
        dbtLayer.id,
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

      const profileA = createLayer({ name: "profile-a" });
      setLayerTags(profileA.id, ["profile"]);
      addResourceToLayer(
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

      const profileB = createLayer({ name: "profile-b" });
      setLayerTags(profileB.id, ["profile"]);
      addResourceToLayer(
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
