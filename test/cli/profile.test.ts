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
      const listInitial = await runCli(["profile", "list"]);
      expect(listInitial.stdout).toContain("default");

      const createResult = await runCli(["profile", "create", "work"]);
      expect(createResult.stdout).toContain("Created profile");

      const listAfter = await runCli(["profile", "list"]);
      expect(listAfter.stdout).toContain("work");
    } finally {
      await context.cleanup();
    }
  });

  it("supports tag/use/active profile flow", async () => {
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

      const tagged = await runCli(["profile", "tag", "work-layer"]);
      expect(tagged.stdout).toContain("Tagged layer");

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

      const active = await runCli(["profile", "active"]);
      expect(active.stdout).toContain("work-layer");
    } finally {
      await context.cleanup();
    }
  });

  it("supports profile search with profile tag filter", async () => {
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
            orgSlug: "harnessdeck-cloud",
            slug: "work-profile",
            name: "Work profile",
            summary: "Profile layer",
            latestVersion: "1.0.0",
            updatedAt: new Date().toISOString(),
            tags: ["profile"],
            visibility: "public",
          },
          {
            orgSlug: "harnessdeck-cloud",
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
        "search",
        "work",
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
        "harnessdeck-cloud/default/team@1.0.0",
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

      const depTarget = createLayer({ name: "local-dep" });
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
      const ref = composition.ensureLayerResource("harnessdeck-cloud/default/remote-base", {
        versionConstraint: "1.0.0",
      });
      addResourceToLayer(profile.id, ref.id);

      const dependencyBundle = formatLayerExportToml({
        $schema: "urn:harnessdeck:layer:v1",
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
          orgSlug: "harnessdeck-cloud",
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
});
