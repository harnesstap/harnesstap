import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { getPluginById } from "../../src/models/plugin-model.ts";
import type { ApPackageFiles } from "../../src/services/agent-plugins/files.ts";
import * as catalogClient from "../../src/services/catalog-client.ts";
import { resolveDownloadedVersion } from "../../src/services/catalog-client.ts";
import { installPluginFromCatalog } from "../../src/services/plugin-catalog-install.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("catalog-pull-identity-");
});

afterEach(async () => {
  await ctx.cleanup();
});

/** The shape harnesstap-cloud/default/backend-engineer serves today. */
function personaPackage(): ApPackageFiles {
  return {
    "plugin.json": {
      encoding: "utf8",
      content: JSON.stringify({
        name: "backend-engineer",
        version: "1.0.0",
        description: "Backend persona",
        extensions: {
          "com.harnesstap": {
            schema: "urn:harnesstap:ap-extension:v1",
            sourceName: "Backend engineer",
            profile: false,
            dependencies: [{ name: "feature-dev", constraint: "1.0.0", source: "local" }],
            overrides: { versions: {}, resources: {} },
            needs: [],
            components: {},
          },
        },
      }),
    },
  } as ApPackageFiles;
}

describe("resolveDownloadedVersion", () => {
  it("replaces latest with the package version and keeps explicit versions", () => {
    expect(resolveDownloadedVersion("latest", personaPackage())).toBe("1.0.0");
    expect(resolveDownloadedVersion("1.0.0", personaPackage())).toBe("1.0.0");
    expect(resolveDownloadedVersion("latest", {} as ApPackageFiles)).toBe("latest");
  });
});

describe("profile pull keeps the catalog identity", () => {
  it("stores the slug, the real version, the profile tag, and a clean head", async () => {
    const files = personaPackage();
    const download = spyOn(catalogClient, "downloadCatalogPackage").mockImplementation(
      async (input) => ({
        version: resolveDownloadedVersion(input.version ?? "latest", files),
        files,
      }),
    );
    const listing = spyOn(catalogClient, "fetchCatalogPlugin").mockRejectedValue(
      new Error("offline"),
    );
    try {
      const pulled = await installPluginFromCatalog(
        { org_slug: "harnesstap-cloud", catalog_slug: "default", plugin_slug: "backend-engineer" },
        { profile: true },
      );
      const plugin = getPluginById(pulled.pluginId);
      expect(plugin?.name).toBe("backend-engineer");
      expect(plugin?.version).toBe("1.0.0");
      expect(plugin?.dirty).toBe(false);
      expect(plugin?.tags).toContain("profile");

      // Pulling @1.0.0 afterwards reuses the same row instead of adding a second one.
      const again = await installPluginFromCatalog(
        {
          org_slug: "harnesstap-cloud",
          catalog_slug: "default",
          plugin_slug: "backend-engineer",
          version: "1.0.0",
        },
        { profile: true },
      );
      expect(again.pluginId).toBe(pulled.pluginId);
    } finally {
      download.mockRestore();
      listing.mockRestore();
    }
  });
});
