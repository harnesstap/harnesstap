import { describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { createCloudPublishFetchMock } from "../helpers/cloud-fetch.ts";
import { initGitRepo } from "../helpers/git.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { makeApEnvelope } from "../helpers/ap-package-fixtures.ts";
import { buildApPackageFiles } from "../../src/services/agent-plugins/files.ts";
import { envelopeFromFiles } from "../../src/services/agent-plugins/envelope.ts";

describe("CLI cloud plugin workflows", () => {
  it("search, add (remote install), publish, apply cloud-installed plugin, and conflict handling", async () => {
    const context = await createTestContext("cli-plugin-cloud");
    try {
      await runCli(["init"]);

      // configure cloud account and stub fetch
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
        plugins: [{
          orgSlug: "harnesstap-cloud",
          slug: "team",
          name: "Team Plugin",
          summary: "Team plugin",
          latestVersion: "1.0.0",
          updatedAt: new Date().toISOString(),
          tags: [],
          visibility: "public",
        }],
      });

      // plugin search should emit JSON when requested and return remote results
      const search = await runCli([
        "plugin",
        "list",
        "--search",
        "team",
        "--remote-only",
        "--account",
        "test",
        "--base-url",
        "https://mock",
        "--format",
        "json",
      ]);
      const searchJson = JSON.parse(search.stdout);
      expect(Array.isArray(searchJson)).toBe(true);
      expect(searchJson[0]).toEqual(expect.objectContaining({
        orgSlug: "harnesstap-cloud",
        catalogSlug: "default",
        slug: "team",
      }));

      // add (remote install) from a remote selector; use --as to pick local name
      const add = await runCli([
        "plugin",
        "pull",
        "harnesstap-cloud/default/team@1.0",
        "--as",
        "team-cloud",
        "--account",
        "test",
        "--base-url",
        "https://mock",
        "--format",
        "json",
      ]);
      const addPayload = JSON.parse(add.stdout);
      expect(addPayload).toEqual(
        expect.objectContaining({
          plugin_name: "team-cloud",
          org_slug: "harnesstap-cloud",
          catalog_slug: "default",
          plugin_slug: "team",
          version: "1.0",
        }),
      );

      // publish should return JSON when requested
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "pubtest" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "r", content: "#x" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const restorePublishFetch = createCloudPublishFetchMock({ baseUrl: "https://mock" });

      await runCli(["plugin", "catalog", "register", "acme/default"]);

      const publish = await runCli(["plugin", "publish", "pubtest", "--account", "test", "--format", "json"]);
      expect(JSON.parse(publish.stdout)).toEqual(
        expect.objectContaining({
          plugin: "pubtest",
          results: [
            expect.objectContaining({ ok: true, version: "1.0.0" }),
          ],
        }),
      );

      restorePublishFetch();

      // applying a cloud-installed plugin through project apply
      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-cloud.git");
      const dryRun = await runCli([
        "apply",
        "team-cloud",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
        "--dry-run",
        "--format",
        "json",
      ]);
      expect(JSON.parse(dryRun.stdout)).toEqual(
        expect.objectContaining({ plugin: "team-cloud" }),
      );

      // add conflict when local plugin name exists and --as missing
      const _conflictPlugin = pluginModel.createPlugin({ name: "conflict" });
      const conflict = await runCli(["plugin", "pull", "org/default/conflict@1.0"]);
      expect(conflict.stderr).toContain("Plugin name already exists");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("ranks exact slug matches first in plugin search results", async () => {
    const context = await createTestContext("cli-plugin-search-rank");
    try {
      await runCli(["init"]);

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        plugins: [
          {
            orgSlug: "harnesstap-cloud",
            slug: "devops-engineer",
            name: "DevOps engineer",
            summary: "fullstack DevOps coverage",
            latestVersion: "1.0.0",
            updatedAt: "2026-06-01T00:00:00.000Z",
            tags: ["fullstack"],
            visibility: "public",
          },
          {
            orgSlug: "harnesstap-cloud",
            slug: "engineering-foundation",
            name: "Engineering foundation",
            summary: "Shared baseline",
            latestVersion: "1.0.0",
            updatedAt: "2026-01-01T00:00:00.000Z",
            tags: ["foundation"],
            visibility: "public",
          },
        ],
      });

      const search = await runCli([
        "plugin",
        "list",
        "--search",
        "engineering-foundation",
        "--remote-only",
        "--base-url",
        "https://mock",
        "--format",
        "json",
      ]);
      const searchJson = JSON.parse(search.stdout) as Array<{ slug: string }>;
      expect(searchJson[0]?.slug).toBe("engineering-foundation");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("project apply resolves a bare catalog name when the plugin is not installed locally", async () => {
    const context = await createTestContext("cli-project-apply-bare-name");
    try {
      await runCli(["init"]);

      const foundationBundle = makeApEnvelope({
        name: "engineering-foundation",
        description: "Shared baseline",
      });

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://harnesstap.com",
        plugins: [{
          orgSlug: "harnesstap-cloud",
          slug: "engineering-foundation",
          name: "Engineering foundation",
          summary: "Shared baseline",
          latestVersion: "1.0.0",
          updatedAt: new Date().toISOString(),
          tags: ["foundation"],
          visibility: "public",
        }],
        bundle: foundationBundle,
      });

      initGitRepo(context.projectDir, "git@github.com:acme/demo.git");

      const dryRun = await runCli([
        "apply",
        "engineering-foundation",
        "--harness",
        "claude-code",
        "--dry-run",
      ]);
      expect(dryRun.stdout).toContain("Fetched harnesstap-cloud/engineering-foundation@1.0.0 from catalog");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("project apply fetches a published selector when the plugin is not installed locally", async () => {
    const context = await createTestContext("cli-project-apply-remote-fetch");
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
        plugins: [{
          orgSlug: "harnesstap-cloud",
          slug: "team",
          name: "Team Plugin",
          summary: "Team plugin",
          latestVersion: "1.0.0",
          updatedAt: new Date().toISOString(),
          tags: [],
          visibility: "public",
        }],
      });

      initGitRepo(context.projectDir, "git@github.com:acme/harnesstap-cloud.git");

      const humanRun = await runCli([
        "apply",
        "harnesstap-cloud/default/team@1.0",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
        "--dry-run",
      ]);
      expect(humanRun.stdout).toContain("Fetched harnesstap-cloud/team@1.0 from catalog");

      const dryRun = await runCli([
        "apply",
        "harnesstap-cloud/default/team@1.0",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
        "--dry-run",
        "--format",
        "json",
      ]);
      expect(dryRun.exitCode).toBeUndefined();
      const dryRunPayload = JSON.parse(dryRun.stdout);
      expect(dryRunPayload).toEqual(
        expect.objectContaining({
          plugin: "remote-team",
          plugins: ["harnesstap-cloud/default/team@1.0"],
        }),
      );

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("plugin pull accepts --org and --version helpers to complete partial selectors", async () => {
    const context = await createTestContext("cli-plugin-add-helpers");
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

      const restoreFetch = createCatalogFetchMock({ baseUrl: "https://mock" });

      // Test --org helper fills missing org
      const withOrg = await runCli([
        "plugin",
        "pull",
        "my-library",
        "--org",
        "harnesstap-cloud",
        "--as",
        "installed-with-org",
        "--account",
        "test",
        "--base-url",
        "https://mock",
        "--format",
        "json",
      ]);
      const withOrgPayload = JSON.parse(withOrg.stdout);
      expect(withOrgPayload).toEqual(
        expect.objectContaining({
          org_slug: "harnesstap-cloud",
          plugin_slug: "my-library",
          version: "latest",
        }),
      );

      // Test --version helper fills missing version
      await runCli([
        "plugin",
        "catalog",
        "connect",
        "org",
        "other-org",
        "--base-url",
        "https://mock",
      ]);

      const withVersion = await runCli([
        "plugin",
        "pull",
        "other-org/default/other-lib",
        "--version",
        "^1.0.0",
        "--as",
        "installed-with-version",
        "--account",
        "test",
        "--base-url",
        "https://mock",
        "--format",
        "json",
      ]);
      
      if (withVersion.exitCode !== 0 && withVersion.exitCode !== undefined) {
        throw new Error(`withVersion command failed: exitCode=${withVersion.exitCode}, stderr=${withVersion.stderr}, stdout=${withVersion.stdout}`);
      }
      
      if (!withVersion.stdout || withVersion.stdout.trim() === "") {
        throw new Error(`withVersion returned empty stdout. stderr: ${withVersion.stderr}`);
      }
      
      const withVersionPayload = JSON.parse(withVersion.stdout);
      expect(withVersionPayload).toEqual(
        expect.objectContaining({
          org_slug: "other-org",
          plugin_slug: "other-lib",
          version: "^1.0.0", // version passed as-is to cloud
        }),
      );

      // Test both helpers together
      const withBoth = await runCli([
        "plugin",
        "pull",
        "combined-lib",
        "--org",
        "harnesstap-cloud",
        "--version",
        "~2.0.0",
        "--as",
        "installed-with-both",
        "--account",
        "test",
        "--base-url",
        "https://mock",
        "--format",
        "json",
      ]);
      
      if (withBoth.exitCode !== 0 && withBoth.exitCode !== undefined) {
        throw new Error(`withBoth command failed: ${withBoth.stderr}`);
      }
      
      if (!withBoth.stdout || withBoth.stdout.trim() === "") {
        throw new Error(`withBoth returned empty stdout. stderr: ${withBoth.stderr}`);
      }
      
      const withBothPayload = JSON.parse(withBoth.stdout);
      expect(withBothPayload).toEqual(
        expect.objectContaining({
          org_slug: "harnesstap-cloud",
          plugin_slug: "combined-lib",
          version: "~2.0.0", // version passed as-is to cloud
        }),
      );

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("plugin pull rejects --org when org is already in selector", async () => {
    const context = await createTestContext("cli-plugin-add-org-conflict");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "plugin",
        "pull",
        "acme/default/library",
        "--org",
        "other-org",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--org conflicts with org in selector");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin pull rejects --version when version is already in selector", async () => {
    const context = await createTestContext("cli-plugin-add-version-conflict");
    try {
      await runCli(["init"]);

      const result = await runCli([
        "plugin",
        "pull",
        "acme/default/library@1.0.0",
        "--version",
        "^2.0.0",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--version conflicts with version in selector");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin pull requires org from selector or --org", async () => {
    const context = await createTestContext("cli-plugin-add-missing-org");
    try {
      await runCli(["init"]);

      const catalog = await import("../../src/config/catalog.ts");
      catalog.saveCatalogSettings(
        { publicCatalog: false },
        join(context.homeDir, ".harnesstap"),
      );

      const result = await runCli([
        "plugin",
        "pull",
        "library-name",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("org is required");
      expect(result.stderr).toContain("--org");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects malformed remote plugin selectors before contacting the cloud", async () => {
    const context = await createTestContext("cli-plugin-cloud-selector");
    try {
      await runCli(["init"]);

      const result = await runCli(["plugin", "pull", "@broken"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid plugin selector");
    } finally {
      await context.cleanup();
    }
  });

  // ── Task 4: Interactive remote plugin search ──────────────────────────────

  it("plugin list --search on TTY launches interactive catalog search and applies to the project", async () => {
    const context = await createTestContext("cli-plugin-search-interactive");
    try {
      await runCli(["init", "--main", "claude-code"]);
      initGitRepo(context.projectDir, "git@github.com:acme/demo.git");

      const cloudAccounts = await import("../../src/config/cloud-accounts.ts");
      await cloudAccounts.saveCloudAccount("test", {
        cloudBaseUrl: "https://mock",
        accessToken: "tok",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        refreshToken: "r",
        scopes: [],
      });
      await cloudAccounts.setDefaultCloudAccount("test");

      const restoreFetch = createCatalogFetchMock({ baseUrl: "https://mock" });

      const result = await runCli(
        ["plugin", "list", "--search", "fullstack", "--remote-only", "--account", "test", "--base-url", "https://mock"],
        {
          isTTY: true,
          promptResponses: [
            { choice: "harnesstap-cloud/default/team" },
            { value: "project" },
          ],
        },
      );

      expect(result.stdout).toContain("Fetched");
      expect(result.stdout).toContain("from catalog");
      expect(result.stdout).toContain("claude-code");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("plugin list --search on non-TTY prints table results", async () => {
    const context = await createTestContext("cli-plugin-search-non-tty");
    try {
      await runCli(["init"]);

      const restoreFetch = createCatalogFetchMock({ baseUrl: "https://mock" });

      const result = await runCli(
        ["plugin", "list", "--search", "team", "--remote-only", "--base-url", "https://mock"],
        { isTTY: false },
      );

      expect(result.stdout).toContain("harnesstap-cloud/default/team");
      expect(result.stdout).not.toContain("Installed plugin");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  // ── Task 4: Publish org resolution ─────────────────────────────────────────

  it("plugin publish uses registered catalogs when no one-off target is provided", async () => {
    const context = await createTestContext("cli-plugin-publish-one-org");
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

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "my-plugin" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "r",
          description: "",
          content: "#test",
        })
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      await runCli(["plugin", "catalog", "register", "acme/default"]);

      const result = await runCli(["plugin", "publish", "my-plugin", "--account", "test", "--format", "json"]);

      expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);
      const payload = JSON.parse(result.stdout);
      expect(payload.results[0]).toEqual(expect.objectContaining({ ok: true, version: "1.0.0" }));

      restorePublishFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("plugin publish fans out to multiple registered catalogs", async () => {
    const context = await createTestContext("cli-plugin-publish-multi-catalog");
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

      const restorePublishFetch = createCloudPublishFetchMock({
        baseUrl: "https://mock",
        orgs: [
          { id: "org-1", slug: "acme", name: "Acme Corp" },
          { id: "org-2", slug: "widgets", name: "Widgets Inc" },
        ],
      });

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "multi-org-plugin" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "r",
          description: "",
          content: "#test",
        })
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      await runCli(["plugin", "catalog", "register", "acme/default"]);
      await runCli(["plugin", "catalog", "register", "widgets/default"]);

      const result = await runCli(
        ["plugin", "publish", "multi-org-plugin", "--account", "test"],
      );

      const stderr = result.stderr
        ?.replace(/^Warning: exportPlugin writes plugin v1[^\n]*\n?/m, "")
        .trim();
      if (stderr) {
        throw new Error(`Command failed with stderr: ${stderr}`);
      }
      expect(result.stdout).toContain("Published multi-org-plugin");

      restorePublishFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("plugin publish errors when no publish catalogs are registered", async () => {
    const context = await createTestContext("cli-plugin-publish-zero-org");
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

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "zero-org-plugin" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "r",
          description: "",
          content: "#test",
        }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const result = await runCli(["plugin", "publish", "zero-org-plugin", "--account", "test"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No publish catalogs registered");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin publish detects existing plugin slug and errors clearly", async () => {
    const context = await createTestContext("cli-plugin-publish-slug-exists");
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

      const restorePublishFetch = createCloudPublishFetchMock({
        baseUrl: "https://mock",
        createStatus: 409,
        patchStatus: 409,
      });

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "existing-slug" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "r",
          description: "",
          content: "#test",
        })
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const result = await runCli([
        "plugin",
        "publish",
        "existing-slug",
        "--org",
        "acme",
        "--account",
        "test",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("already exists");

      restorePublishFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("plugin pull resolves three-part selectors against the catalog API", async () => {
    const context = await createTestContext("cli-plugin-add-three-part");
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
        plugins: [{
          orgSlug: "acme",
          catalogSlug: "personas",
          slug: "frontend",
          name: "Frontend Persona",
          summary: "Frontend persona plugin",
          latestVersion: "2.0.0",
          updatedAt: new Date().toISOString(),
          tags: [],
          visibility: "public",
        }],
      });

      const result = await runCli([
        "plugin",
        "pull",
        "acme/personas/frontend@2.0.0",
        "--as",
        "persona-frontend",
        "--account",
        "test",
        "--base-url",
        "https://mock",
        "--format",
        "json",
      ]);

      expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);
      expect(JSON.parse(result.stdout)).toEqual(
        expect.objectContaining({
          plugin_name: "persona-frontend",
          org_slug: "acme",
          catalog_slug: "personas",
          plugin_slug: "frontend",
          version: "2.0.0",
        }),
      );

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("plugin publish passes catalog_slug to the cloud publish API", async () => {
    const context = await createTestContext("cli-plugin-publish-catalog");
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

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "catalog-plugin" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "r", content: "#x" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      let createPayload: Record<string, unknown> | undefined;
      const restorePublishFetch = createCloudPublishFetchMock({
        baseUrl: "https://mock",
        onCreate: (body) => {
          createPayload = body;
        },
      });

      const result = await runCli([
        "plugin",
        "publish",
        "catalog-plugin",
        "--org",
        "acme",
        "--catalog",
        "platform-personas",
        "--account",
        "test",
        "--format",
        "json",
      ]);

      expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);
      expect(createPayload).toEqual(
        expect.objectContaining({
          name: "catalog-plugin",
          catalogSlug: "platform-personas",
        }),
      );

      restorePublishFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("plugin pull rejects ambiguous bare slugs with candidate selectors", async () => {
    const context = await createTestContext("cli-plugin-pull-bare-ambiguous");
    try {
      await runCli(["init"]);
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      mkdirSync(harnesstapDir, { recursive: true });
      const catalog = await import("../../src/config/catalog.ts");
      catalog.connectCatalogOrg("acme", harnesstapDir);

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        plugins: [
          {
            orgSlug: "harnesstap-cloud",
            slug: "team",
            name: "Team",
            summary: "A",
            latestVersion: "1.0.0",
            updatedAt: new Date().toISOString(),
            tags: [],
            visibility: "public",
          },
          {
            orgSlug: "acme",
            slug: "team",
            name: "Team",
            summary: "B",
            latestVersion: "2.0.0",
            updatedAt: new Date().toISOString(),
            tags: [],
            visibility: "public",
          },
        ],
      });

      const result = await runCli([
        "plugin",
        "pull",
        "team",
        "--base-url",
        "https://mock",
        "--no-interactive",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Ambiguous plugin name: team");
      expect(result.stderr).toContain("harnesstap-cloud/default/team");
      expect(result.stderr).toContain("acme/default/team");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("plugin pull installs a public default-catalog plugin without a cloud account", async () => {
    const context = await createTestContext("cli-plugin-add-anonymous");
    try {
      await runCli(["init"]);
      const restoreFetch = createCatalogFetchMock({ baseUrl: "https://cloud.harnesstap.com" });

      const result = await runCli([
        "plugin",
        "pull",
        "harnesstap-cloud/default/team@1.0",
        "--as",
        "oss-team",
        "--format",
        "json",
      ]);

      expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);
      expect(JSON.parse(result.stdout)).toEqual(
        expect.objectContaining({
          plugin_name: "oss-team",
          org_slug: "harnesstap-cloud",
          plugin_slug: "team",
        }),
      );

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("plugin catalog connect org expands the saved catalog scope", async () => {
    const context = await createTestContext("cli-plugin-catalog-connect-org");
    try {
      await runCli(["init"]);
      const restoreFetch = createCatalogFetchMock({ baseUrl: "https://mock" });

      const connect = await runCli([
        "plugin",
        "catalog",
        "connect",
        "org",
        "acme",
        "--base-url",
        "https://mock",
      ]);
      expect(connect.stdout).toContain("Connected catalog org");

      const list = await runCli(["plugin", "catalog", "list", "--format", "json"]);
      const payload = JSON.parse(list.stdout);
      expect(payload.connectedOrgs).toEqual(["acme"]);

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  // ── Task 4: from-project conflict resolution ──────────────────────────────

  it("plugin from-project errors when plugin exists without interactive mode", async () => {
    const context = await createTestContext("cli-plugin-from-project-exists");
    try {
      await runCli(["init"]);

      // Create an existing plugin
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const existingPlugin = pluginModel.createPlugin({ name: "existing" });
      const existingResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "res",
          description: "original",
          content: "#original",
        })
      );
      pluginModel.addResourceToPlugin(existingPlugin.id, existingResource.id);

      // Create a project directory
      const { mkdirSync } = await import("node:fs");
      const { join } = await import("node:path");
      const projectDir = join(context.homeDir, "test-project");
      mkdirSync(projectDir, { recursive: true });

      // Try to create plugin with same name in non-interactive mode
      const result = await runCli(
        ["plugin", "from-project", "existing", "--project", projectDir],
        { isTTY: false }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("already exists");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin from-project with conflict shows preview and allows overwrite", async () => {
    const context = await createTestContext("cli-plugin-from-project-overwrite");
    try {
      await runCli(["init"]);

      // Create an existing plugin with a resource
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const existingPlugin = pluginModel.createPlugin({ name: "myplugin" });
      const existingResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "cursorrules",
          description: "old cursor rules",
          content: "# OLD CONTENT",
        })
      );
      pluginModel.addResourceToPlugin(existingPlugin.id, existingResource.id);

      // Verify initial state
      const initialResources = pluginModel.getPluginResources(existingPlugin.id);
      expect(initialResources.length).toBe(1);
      expect(initialResources[0].content).toBe("# OLD CONTENT");

      // Create a project directory with a file that will be scanned
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const projectDir = join(context.homeDir, "test-project-over");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, ".cursorrules"), "# NEW CONTENT\nThis is updated");

      // Run from-project with interactive mode and choose overwrite
      const result = await runCli(
        ["plugin", "from-project", "myplugin", "--project", projectDir],
        {
          isTTY: true,
          promptResponses: [{ value: "overwrite" }]
        }
      );

      // Should show preview information
      expect(result.stdout).toContain("already exists");
      expect(result.stdout).toMatch(/conflict|Conflict/i);

      // Should complete successfully
      expect(result.stdout).toMatch(/Created plugin|Updated plugin/i);

      // Verify the plugin was updated (not just content changed)
      const updatedPlugin = pluginModel.getPlugin("myplugin");
      expect(updatedPlugin).toBeTruthy();
      if (!updatedPlugin) throw new Error("Expected updated plugin to exist");
      const updatedResources = pluginModel.getPluginResources(updatedPlugin.id);
      
      // Should have new content
      const cursorRulesResource = updatedResources.find(r => r.name === "cursorrules");
      expect(cursorRulesResource).toBeTruthy();
      if (!cursorRulesResource) throw new Error("Expected cursor rules resource to exist");
      expect(cursorRulesResource.content).toContain("NEW CONTENT");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin from-project with conflict shows preview and allows rename", async () => {
    const context = await createTestContext("cli-plugin-from-project-rename");
    try {
      await runCli(["init"]);

      // Create an existing plugin
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const existingPlugin = pluginModel.createPlugin({ name: "original" });
      const existingResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "cursorrules",
          description: "original rules",
          content: "# ORIGINAL",
        })
      );
      pluginModel.addResourceToPlugin(existingPlugin.id, existingResource.id);

      // Verify initial state
      const initialResources = pluginModel.getPluginResources(existingPlugin.id);
      expect(initialResources.length).toBe(1);
      expect(initialResources[0].content).toBe("# ORIGINAL");

      // Create a project directory with new content
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const projectDir = join(context.homeDir, "test-project-rename");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, ".cursorrules"), "# RENAMED CONTENT");

      // Run from-project and choose rename
      const result = await runCli(
        ["plugin", "from-project", "original", "--project", projectDir],
        {
          isTTY: true,
          promptResponses: [
            { value: "rename" },
            { value: "original-renamed" }
          ]
        }
      );

      // Should show preview
      expect(result.stdout).toContain("already exists");
      
      // Should complete successfully
      expect(result.stdout).toMatch(/Created plugin/i);

      // Verify original plugin is unchanged
      const originalPlugin = pluginModel.getPlugin("original");
      expect(originalPlugin).toBeTruthy();
      if (!originalPlugin) throw new Error("Expected original plugin to exist");
      const originalResources = pluginModel.getPluginResources(originalPlugin.id);
      expect(originalResources[0].content).toBe("# ORIGINAL");

      // Verify new plugin was created
      const renamedPlugin = pluginModel.getPlugin("original-renamed");
      expect(renamedPlugin).toBeTruthy();
      if (!renamedPlugin) throw new Error("Expected renamed plugin to exist");
      const renamedResources = pluginModel.getPluginResources(renamedPlugin.id);
      const renamedCursorRules = renamedResources.find(r => r.name === "cursorrules");
      expect(renamedCursorRules).toBeTruthy();
      if (!renamedCursorRules) throw new Error("Expected cursor rules resource to exist");
      expect(renamedCursorRules.content).toContain("RENAMED CONTENT");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin from-project with conflict shows preview and allows cancel", async () => {
    const context = await createTestContext("cli-plugin-from-project-cancel");
    try {
      await runCli(["init"]);

      // Create an existing plugin
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const existingPlugin = pluginModel.createPlugin({ name: "tocancel" });
      const existingResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "cursorrules",
          description: "original",
          content: "# SHOULD NOT CHANGE",
        })
      );
      pluginModel.addResourceToPlugin(existingPlugin.id, existingResource.id);

      // Record initial state
      const initialPluginCount = pluginModel.listPlugins().length;
      const initialResources = pluginModel.getPluginResources(existingPlugin.id);
      expect(initialResources.length).toBe(1);
      expect(initialResources[0].content).toBe("# SHOULD NOT CHANGE");

      // Create a project directory
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const projectDir = join(context.homeDir, "test-project-cancel");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, ".cursorrules"), "# THIS SHOULD NOT BE IMPORTED");

      // Run from-project and choose cancel
      const result = await runCli(
        ["plugin", "from-project", "tocancel", "--project", projectDir],
        {
          isTTY: true,
          promptResponses: [{ value: "cancel" }]
        }
      );

      // Should show preview
      expect(result.stdout).toContain("already exists");
      
      // Should indicate cancellation
      expect(result.stdout).toMatch(/cancel|Cancel/i);

      // Verify no changes were made to the plugin
      const unchangedPlugin = pluginModel.getPlugin("tocancel");
      expect(unchangedPlugin).toBeTruthy();
      if (!unchangedPlugin) throw new Error("Expected unchanged plugin to exist");
      const unchangedResources = pluginModel.getPluginResources(unchangedPlugin.id);
      expect(unchangedResources.length).toBe(1);
      expect(unchangedResources[0].content).toBe("# SHOULD NOT CHANGE");

      // Verify no new plugins were created
      expect(pluginModel.listPlugins().length).toBe(initialPluginCount);
    } finally {
      await context.cleanup();
    }
  });

  it("plugin from-project with only new resources (no conflicts) errors clearly in non-interactive mode", async () => {
    const context = await createTestContext("cli-plugin-from-project-new-only");
    try {
      await runCli(["init"]);

      // Create an existing plugin with a resource
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const existingPlugin = pluginModel.createPlugin({ name: "existing" });
      const existingResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "other-resource",
          description: "unrelated",
          content: "# UNRELATED",
        })
      );
      pluginModel.addResourceToPlugin(existingPlugin.id, existingResource.id);

      // Create a project directory with a NEW resource (not conflicting)
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const projectDir = join(context.homeDir, "test-project-new");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, ".cursorrules"), "# NEW RESOURCE");

      // Try to create plugin in non-interactive mode
      const result = await runCli(
        ["plugin", "from-project", "existing", "--project", projectDir],
        { isTTY: false }
      );

      expect(result.exitCode).toBe(1);
      // Should mention new resources, not conflicting resources
      expect(result.stderr).toContain("already exists");
      expect(result.stderr).not.toContain("0 conflicting");
      expect(result.stderr).toMatch(/1 new resource/i);
      expect(result.stderr).not.toMatch(/conflicting/i);
    } finally {
      await context.cleanup();
    }
  });

  it("plugin from-project with only new resources shows accurate preview in interactive mode", async () => {
    const context = await createTestContext("cli-plugin-from-project-new-interactive");
    try {
      await runCli(["init"]);

      // Create an existing plugin with a resource
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const { makeResourceInput } = await import("../helpers/resources.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const existingPlugin = pluginModel.createPlugin({ name: "existing-new" });
      const existingResource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "existing-res",
          description: "existing",
          content: "# EXISTING",
        })
      );
      pluginModel.addResourceToPlugin(existingPlugin.id, existingResource.id);

      // Create a project directory with a NEW resource
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const projectDir = join(context.homeDir, "test-new-interactive");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, ".cursorrules"), "# NEW");

      // Interactive mode with cancel to check messaging
      const result = await runCli(
        ["plugin", "from-project", "existing-new", "--project", projectDir],
        {
          isTTY: true,
          promptResponses: [{ value: "cancel" }]
        }
      );

      // Should show accurate preview
      expect(result.stdout).toContain("already exists");
      expect(result.stdout).toMatch(/New resources: 1 would be added/);
      // Should NOT show conflicts when there are none
      expect(result.stdout).not.toMatch(/Conflicts:/);
      expect(result.stdout).not.toMatch(/0.*overwritten/);
    } finally {
      await context.cleanup();
    }
  });

  it("plugin publish rejects dirty plugins without --version", async () => {
    const context = await createTestContext("cli-plugin-publish-dirty");
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

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const versioning = await import("../../src/services/plugin-versioning.ts");
      const plugin = pluginModel.createPlugin({ name: "dirty-pub", version: "1.0.0" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "r", content: "#x" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);
      versioning.markPluginDirty(plugin.id);

      await runCli(["plugin", "catalog", "register", "acme/default"]);

      const result = await runCli(
        ["plugin", "publish", "dirty-pub", "--account", "test"],
        { isTTY: false },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unpublished edits");
      expect(result.stderr).toContain("--version");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin publish --version cuts dirty head then publishes", async () => {
    const context = await createTestContext("cli-plugin-publish-cut");
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

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const versioning = await import("../../src/services/plugin-versioning.ts");
      const plugin = pluginModel.createPlugin({ name: "cut-pub", version: "1.0.0" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "r", content: "#x" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);
      versioning.markPluginDirty(plugin.id);

      const restorePublishFetch = createCloudPublishFetchMock({ baseUrl: "https://mock" });

      await runCli(["plugin", "catalog", "register", "acme/default"]);

      const publish = await runCli([
        "plugin",
        "publish",
        "cut-pub",
        "--version",
        "1.1.0",
        "--account",
        "test",
        "--format",
        "json",
      ]);

      expect(publish.exitCode === undefined || publish.exitCode === 0).toBe(true);
      expect(JSON.parse(publish.stdout)).toEqual(
        expect.objectContaining({
          plugin: "cut-pub",
          results: [expect.objectContaining({ ok: true, version: "1.0.0" })],
        }),
      );

      const { closeDb, getDb } = await import("../../src/db/connection.ts");
      closeDb();
      const rows = getDb()
        .prepare(
          "SELECT version, dirty, frozen_at FROM plugins WHERE name = ? ORDER BY frozen_at IS NULL DESC",
        )
        .all("cut-pub") as Array<{
        version: string;
        dirty: number;
        frozen_at: string | null;
      }>;
      const head = rows.find((row) => row.frozen_at == null);
      const frozen = rows.find((row) => row.frozen_at != null);
      expect(head?.dirty).toBe(0);
      expect(frozen?.version).toBe("1.0.0");
      expect(frozen?.frozen_at).toBeTruthy();

      restorePublishFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("migrate export rejects dirty plugin heads", async () => {
    const context = await createTestContext("cli-migrate-export-dirty");
    try {
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const versioning = await import("../../src/services/plugin-versioning.ts");
      const plugin = pluginModel.createPlugin({ name: "dirty-migrate", version: "1.0.0" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "r", content: "#x" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);
      versioning.markPluginDirty(plugin.id);

      const bundlePath = join(context.projectDir, "dirty.ap.json");
      const result = await runCli([
        "migrate",
        "export",
        bundlePath,
        "--plugin",
        "dirty-migrate",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Cannot share plugins with unpublished edits");
    } finally {
      await context.cleanup();
    }
  });

  it("publishes an Agent Plugins package", async () => {
    const context = await createTestContext("cli-plugin-publish-ap-package");
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

      const bodies: Array<Record<string, unknown>> = [];
      const restore = createCloudPublishFetchMock({
        baseUrl: "https://mock",
        onPatch: (body) => bodies.push(body),
      });
      try {
        const pluginModel = await import("../../src/models/plugin-model.ts");
        const resourceModel = await import("../../src/models/resource.ts");
        const plugin = pluginModel.createPlugin({ name: "planner", version: "1.0.0" });
        pluginModel.addResourceToPlugin(
          plugin.id,
          resourceModel.createResource(
            makeResourceInput({
              type: "skill",
              name: "plan",
              description: "Planning",
              content: "# Plan",
              metadata: {},
              source: "test",
            }),
          ).id,
        );

        const result = await runCli([
          "plugin",
          "publish",
          "planner",
          "acme/main",
          "--account",
          "test",
        ]);
        expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);

        const patch = bodies.find((body) => "package" in body);
        expect(patch).toBeDefined();
        const apPackage = patch?.package as {
          schema: string;
          files: Record<string, { encoding: string; content: string }>;
        };
        expect(apPackage.schema).toBe("urn:harnesstap:ap-package:v1");
        expect(Object.keys(apPackage.files).sort()).toEqual([
          "plugin.json",
          "skills/plan/SKILL.md",
        ]);
        expect(JSON.parse(apPackage.files["plugin.json"]!.content).name).toBe("planner");
      } finally {
        restore();
      }
    } finally {
      await context.cleanup();
    }
  });

  it("sends no TOML body", async () => {
    const context = await createTestContext("cli-plugin-publish-no-toml");
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

      const bodies: Array<Record<string, unknown>> = [];
      const restore = createCloudPublishFetchMock({
        baseUrl: "https://mock",
        onPatch: (body) => bodies.push(body),
      });
      try {
        const pluginModel = await import("../../src/models/plugin-model.ts");
        pluginModel.createPlugin({ name: "planner", version: "1.0.0" });
        await runCli([
          "plugin",
          "publish",
          "planner",
          "acme/main",
          "--account",
          "test",
        ]);
        const patch = bodies.find((body) => "package" in body);
        expect(patch).not.toHaveProperty("harnesstapLayerExportBody");
        expect(patch).not.toHaveProperty("layerExport");
        expect(patch).not.toHaveProperty("harnesstapPluginExportBody");
        expect(patch).not.toHaveProperty("pluginExport");
      } finally {
        restore();
      }
    } finally {
      await context.cleanup();
    }
  });

  it("sends the envelope bytes that --single-file would write", async () => {
    const context = await createTestContext("cli-plugin-publish-envelope-parity");
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

      const bodies: Array<Record<string, unknown>> = [];
      const restore = createCloudPublishFetchMock({
        baseUrl: "https://mock",
        onPatch: (body) => bodies.push(body),
      });
      try {
        const pluginModel = await import("../../src/models/plugin-model.ts");
        const plugin = pluginModel.createPlugin({ name: "planner", version: "1.0.0" });
        await runCli([
          "plugin",
          "publish",
          "planner",
          "acme/main",
          "--account",
          "test",
        ]);
        const patch = bodies.find((body) => "package" in body);
        expect(patch?.package).toEqual(envelopeFromFiles(buildApPackageFiles(plugin.id)));
      } finally {
        restore();
      }
    } finally {
      await context.cleanup();
    }
  });
});
