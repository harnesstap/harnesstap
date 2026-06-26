import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI output format", () => {
  it("emits JSON for layer, status, history, harness, init, and apply dry-run commands", async () => {
    const context = await createTestContext("cli-output-format");
    try {
      await runCli(["init"]);
      const platforms = await runCli(["harness", "list", "--format", "json"]);
      expect(JSON.parse(platforms.stdout)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "claude-code" })]),
      );

      const initResult = await runCli(["init", "--format", "json"]);
      expect(JSON.parse(initResult.stdout)).toEqual(
        expect.objectContaining({
          database_path: expect.any(String),
          home_defaults: expect.any(Array),
        }),
      );

      const layerList = await runCli(["layer", "list", "--local-only", "--format", "json"]);
      expect(Array.isArray(JSON.parse(layerList.stdout))).toBe(true);

      const layerListCombined = await runCli(["layer", "list", "--format", "json", "--no-interactive"]);
      const combined = JSON.parse(layerListCombined.stdout) as { local: unknown[]; remote: unknown[] };
      expect(Array.isArray(combined.local)).toBe(true);
      expect(Array.isArray(combined.remote)).toBe(true);

      initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-output.git");
      const layerModel = await import("../../src/models/layer-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "dry-run-layer" });
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "instruction",
          name: "dry-run",
          content: "# Dry run",
        }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      const dryRun = await runCli([
        "layer", "apply",
        "dry-run-layer",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
        "--dry-run",
        "--format",
        "json",
      ]);
      expect(JSON.parse(dryRun.stdout)).toEqual(
        expect.objectContaining({
          layer: "dry-run-layer",
          project_root: expect.any(String),
          platforms: expect.any(Array),
        }),
      );

      await runCli([
        "layer", "apply",
        "dry-run-layer",
        "--project",
        context.projectDir,
        "--harness",
        "claude-code",
      ]);

      const status = await runCli([
        "status",
        context.projectDir,
        "--format",
        "json",
      ]);
      expect(JSON.parse(status.stdout)).toEqual(
        expect.objectContaining({
          project_root: expect.any(String),
          git_origin: expect.any(String),
          platforms: expect.any(Array),
        }),
      );

      const history = await runCli(["history", context.projectDir,
        "--format",
        "json",
      ]);
      const historyPayload = JSON.parse(history.stdout);
      expect(Array.isArray(historyPayload)).toBe(true);
      expect(historyPayload[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          label: expect.any(String),
        }),
      );

      const cloudWhoami = await runCli(["auth", "status", "--format", "json"]);
      expect(JSON.parse(cloudWhoami.stdout)).toBeDefined();

      const cloudOrgs = await runCli(["auth", "orgs", "--format", "json"]);
      expect(Array.isArray(JSON.parse(cloudOrgs.stdout))).toBe(true);

      const cloudAccounts = await import("../../src/config/cloud-accounts.ts");
      await cloudAccounts.saveCloudAccount("test", {
        cloudBaseUrl: "https://mock",
        accessToken: "tok",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        refreshToken: "r",
        scopes: [],
      });
      await cloudAccounts.setDefaultCloudAccount("test");

      const { createCatalogFetchMock } = await import("../helpers/catalog-fetch.ts");
      const { createCloudPublishFetchMock } = await import("../helpers/cloud-fetch.ts");
      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        layers: [{
          orgSlug: "harnessdeck-cloud",
          slug: "lib",
          name: "Lib Layer",
          summary: "Remote layer",
          latestVersion: "1.0.0",
          updatedAt: new Date().toISOString(),
          tags: [],
          visibility: "public",
        }],
      });
      const restorePublishFetch = createCloudPublishFetchMock({ baseUrl: "https://mock" });

      try {
        const search = await runCli([
          "layer",
          "list",
          "--search",
          "x",
          "--remote-only",
          "--account",
          "test",
          "--base-url",
          "https://mock",
          "--format",
          "json",
        ]);
        expect(Array.isArray(JSON.parse(search.stdout))).toBe(true);

        const install = await runCli([
          "layer",
          "pull",
          "harnessdeck-cloud/default/lib@1.0",
          "--as",
          "lib-local",
          "--account",
          "test",
          "--base-url",
          "https://mock",
          "--format",
          "json",
        ]);
        expect(JSON.parse(install.stdout)).toEqual(
          expect.objectContaining({
            layer_name: expect.any(String),
            org_slug: expect.any(String),
            layer_slug: expect.any(String),
            version: expect.anything(),
          }),
        );

        const publishLayer = layerModel.createLayer({ name: "pub1" });
        const publishResource = resourceModel.createResource(
          makeResourceInput({ name: "x", content: "#" }),
        );
        layerModel.addResourceToLayer(publishLayer.id, publishResource.id);

        await runCli(["layer", "catalog", "register", "acme/default"]);

        const publish = await runCli([
          "layer",
          "publish",
          "pub1",
          "--account",
          "test",
          "--format",
          "json",
        ]);
        expect(JSON.parse(publish.stdout)).toBeDefined();
      } finally {
        restorePublishFetch();
        restoreFetch();
      }
    } finally {
      await context.cleanup();
    }
  });

  it("resource sync preserves JSON output shape", async () => {
    const context = await createTestContext("cli-of-resource-sync");
    try {
      await runCli(["init"]);
      const sync = await runCli(["resource", "sync", "--format", "json"]);
      const parsed = JSON.parse(sync.stdout) as {
        checked: number;
        updated: unknown[];
        stale: unknown[];
        unchanged: unknown[];
        skipped: unknown[];
      };
      expect(typeof parsed.checked).toBe("number");
      expect(Array.isArray(parsed.updated)).toBe(true);
      expect(Array.isArray(parsed.skipped)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
