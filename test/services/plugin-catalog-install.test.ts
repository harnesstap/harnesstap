import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { createPlugin, getPluginById } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addResourceToPlugin } from "../../src/models/plugin-model.ts";
import { buildApPackageFiles } from "../../src/services/agent-plugins/files.ts";
import * as catalogClient from "../../src/services/catalog-client.ts";
import { installPluginFromCatalog } from "../../src/services/plugin-catalog-install.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("catalog-install-origin-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("installPluginFromCatalog origin locator", () => {
  it("stamps org/catalog/plugin_slug even when --as renames the local plugin", async () => {
    const source = createPlugin({ name: "foundation", version: "1.0.0" });
    addResourceToPlugin(
      source.id,
      createResource({
        type: "skill",
        name: "hello",
        description: "",
        content: "# hi",
        metadata: {},
        source: "test",
      }).id,
    );
    const files = buildApPackageFiles(source.id);

    const downloadSpy = spyOn(catalogClient, "downloadCatalogPackage").mockResolvedValue({
      version: "1.0.0",
      files,
    });

    const installed = await installPluginFromCatalog(
      {
        org_slug: "acme",
        catalog_slug: "default",
        plugin_slug: "foundation",
        version: "1.0.0",
      },
      { as: "local-foundation" },
    );

    expect(installed.pluginName).toBe("local-foundation");
    expect(getPluginById(installed.pluginId)?.origin_locator).toBe("acme/default/foundation");
    expect(downloadSpy).toHaveBeenCalled();
    downloadSpy.mockRestore();
  });
});
