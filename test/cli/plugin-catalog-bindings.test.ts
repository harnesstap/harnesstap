import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { createCloudPublishFetchMock } from "../helpers/cloud-fetch.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI plugin catalog publish bindings", () => {
  it("registers catalogs and configures per-plugin publish targets", async () => {
    const context = await createTestContext("cli-plugin-catalog-bindings");
    try {
      await runCli(["init"]);

      const register = await runCli([
        "plugin",
        "catalog",
        "register",
        "acme/internal",
        "--format",
        "json",
      ]);
      expect(JSON.parse(register.stdout)).toEqual(
        expect.objectContaining({
          created: true,
          catalog: { org: "acme", catalog: "internal" },
        }),
      );

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "team" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "guide", content: "# team" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const bind = await runCli([
        "plugin",
        "catalog",
        "bindings",
        "team",
        "--add",
        "acme/internal",
        "--format",
        "json",
      ]);
      expect(JSON.parse(bind.stdout)).toEqual(
        expect.objectContaining({
          plugin: "team",
          mode: "explicit",
          effective: [{ org: "acme", catalog: "internal" }],
        }),
      );

      const show = await runCli(["plugin", "catalog", "bindings", "team", "--format", "json"]);
      expect(JSON.parse(show.stdout)).toEqual(
        expect.objectContaining({
          plugin: "team",
          mode: "explicit",
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("publishes to all registered catalogs by default", async () => {
    const context = await createTestContext("cli-plugin-publish-all-registered");
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

      await runCli(["plugin", "catalog", "register", "acme/internal"]);
      await runCli(["plugin", "catalog", "register", "widgets/default"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "fanout" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "r", content: "#x" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const publishCalls: string[] = [];
      const restorePublishFetch = createCloudPublishFetchMock({
        baseUrl: "https://mock",
        orgs: [
          { id: "org-1", slug: "acme", name: "Acme Corp" },
          { id: "org-2", slug: "widgets", name: "Widgets Inc" },
        ],
        onCreate: (body) => {
          publishCalls.push(String(body.catalogSlug));
        },
      });

      const result = await runCli([
        "plugin",
        "publish",
        "fanout",
        "--account",
        "test",
        "--format",
        "json",
      ]);
      const payload = JSON.parse(result.stdout);
      expect(payload.results).toHaveLength(2);
      expect(payload.results.every((entry: { ok: boolean }) => entry.ok)).toBe(true);
      expect(publishCalls.sort()).toEqual(["default", "internal"]);

      restorePublishFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("supports one-off publish without changing bindings", async () => {
    const context = await createTestContext("cli-plugin-publish-one-off");
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
      const plugin = pluginModel.createPlugin({ name: "oneoff" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "r", content: "#x" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const restorePublishFetch = createCloudPublishFetchMock({ baseUrl: "https://mock" });
      const result = await runCli([
        "plugin",
        "publish",
        "oneoff",
        "acme/platform-personas",
        "--account",
        "test",
        "--format",
        "json",
      ]);
      expect(JSON.parse(result.stdout).results).toEqual([
        expect.objectContaining({
          org: "acme",
          catalog: "platform-personas",
          ok: true,
        }),
      ]);

      const bindings = await runCli(["plugin", "catalog", "bindings", "oneoff", "--format", "json"]);
      expect(JSON.parse(bindings.stdout).mode).toBe("all_registered");

      restorePublishFetch();
    } finally {
      await context.cleanup();
    }
  });
});
